from __future__ import annotations

import math
import os
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from typing import Any, Protocol, TypeVar

import google.auth
from google import genai
from google.auth.transport.requests import AuthorizedSession
from google.genai import types

from homeoremedica_corpus.chunking import Chunk
from homeoremedica_corpus.sources import CorpusValidationError


@dataclass(frozen=True, slots=True)
class EmbeddingSpec:
    model: str = "gemini-embedding-001"
    dimensions: int = 768
    document_task_type: str = "RETRIEVAL_DOCUMENT"
    query_task_type: str = "RETRIEVAL_QUERY"
    normalization: str = "l2"
    distance_function: str = "cosine"
    model_input_limit: int = 2048

    def __post_init__(self) -> None:
        if not 1 <= self.dimensions <= 3072:
            raise ValueError("embedding dimensions must be between 1 and 3072")
        if self.model_input_limit <= 0:
            raise ValueError("embedding model input limit must be positive")
        if self.normalization != "l2" or self.distance_function != "cosine":
            raise ValueError("this artifact schema requires L2 normalization and cosine distance")


class EmbeddingProvider(Protocol):
    dimensions: int

    def count_tokens(self, text: str) -> int: ...

    def embed_document(self, text: str) -> tuple[float, ...]: ...

    def embed_query(self, text: str) -> tuple[float, ...]: ...


TokenCounter = Callable[[str], int]
ProgressCallback = Callable[[int, int], None]
Input = TypeVar("Input")
Output = TypeVar("Output")


@dataclass(frozen=True, slots=True)
class EmbeddedChunk:
    chunk: Chunk
    embedding: tuple[float, ...]


class _VertexTokenCounter:
    def __init__(
        self,
        *,
        project: str,
        location: str,
        model: str,
        session: Any,
    ) -> None:
        if location == "global":
            raise ValueError(
                f"{model} token counting requires a regional Vertex AI location; "
                "use --location us-central1"
            )
        self._session = session
        self._url = (
            f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/"
            f"locations/{location}/publishers/google/models/{model}:countTokens"
        )

    def __call__(self, text: str) -> int:
        response = self._session.post(
            self._url,
            json={"instances": [{"content": text}]},
            timeout=60,
        )
        response.raise_for_status()
        total = response.json().get("totalTokens")
        if not isinstance(total, int) or isinstance(total, bool):
            raise RuntimeError("Vertex AI did not return an embedding input token count")
        return total


class VertexEmbeddingProvider:
    """Vertex AI embedding access with truncation and normalization hidden from callers."""

    def __init__(
        self,
        spec: EmbeddingSpec,
        *,
        project: str | None = None,
        location: str | None = None,
        client: Any | None = None,
        token_counter: TokenCounter | None = None,
    ) -> None:
        self.spec = spec
        self.dimensions = spec.dimensions
        if token_counter is None:
            credentials, default_project = google.auth.default(
                scopes=("https://www.googleapis.com/auth/cloud-platform",)
            )
            project = project or os.environ.get("GOOGLE_CLOUD_PROJECT") or default_project
            location = location or os.environ.get("GOOGLE_CLOUD_LOCATION")
            if not project or not location:
                raise ValueError("Vertex AI project and regional location are required")
            token_counter = _VertexTokenCounter(
                project=project,
                location=location,
                model=spec.model,
                session=AuthorizedSession(credentials),
            )
        if client is None:
            client = genai.Client(
                vertexai=True,
                project=project,
                location=location,
            )
        self._client = client
        self._token_counter = token_counter

    def with_dimensions(self, dimensions: int) -> VertexEmbeddingProvider:
        return VertexEmbeddingProvider(
            replace(self.spec, dimensions=dimensions),
            client=self._client,
            token_counter=self._token_counter,
        )

    def count_tokens(self, text: str) -> int:
        return self._token_counter(text)

    def embed_document(self, text: str) -> tuple[float, ...]:
        return self._embed(text, self.spec.document_task_type)

    def embed_query(self, text: str) -> tuple[float, ...]:
        return self._embed(text, self.spec.query_task_type)

    def _embed(self, text: str, task_type: str) -> tuple[float, ...]:
        response = self._client.models.embed_content(
            model=self.spec.model,
            contents=text,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=self.spec.dimensions,
                auto_truncate=False,
            ),
        )
        embeddings = response.embeddings or []
        if len(embeddings) != 1:
            raise RuntimeError(f"Vertex AI returned {len(embeddings)} embeddings for one input")
        result = embeddings[0]
        statistics = result.statistics
        if statistics is not None and statistics.truncated:
            raise RuntimeError("Vertex AI truncated an embedding despite auto_truncate=False")
        values = result.values or []
        if len(values) != self.spec.dimensions:
            raise RuntimeError(
                "Vertex AI returned the wrong embedding dimensions "
                f"(expected {self.spec.dimensions}, got {len(values)})"
            )
        return _normalize_l2(values)


def preflight_embedding_inputs(
    chunks: Iterable[Chunk],
    provider: EmbeddingProvider,
    model_input_limit: int,
    *,
    workers: int = 1,
    progress: ProgressCallback | None = None,
) -> None:
    materialized = tuple(chunks)
    oversized: list[str] = []
    inputs = (chunk.embedding_text for chunk in materialized)
    for completed, (chunk, token_count) in enumerate(
        zip(materialized, _bounded_map(provider.count_tokens, inputs, workers), strict=True),
        start=1,
    ):
        if token_count > model_input_limit:
            passage_label = (
                f"passage {chunk.passage_indexes[0]}"
                if len(chunk.passage_indexes) == 1
                else "passages " + ",".join(str(index) for index in chunk.passage_indexes)
            )
            oversized.append(
                f"{chunk.book_id} / {chunk.remedy_name} / {chunk.section_title} / "
                f"{passage_label}: {token_count} tokens exceeds {model_input_limit}"
            )
        if progress is not None:
            progress(completed, len(materialized))
    if oversized:
        raise CorpusValidationError(
            "Embedding input validation failed before embedding:\n- " + "\n- ".join(oversized)
        )


def embed_chunks(
    chunks: Iterable[Chunk],
    provider: EmbeddingProvider,
    model_input_limit: int,
    *,
    preflight: bool = True,
    workers: int = 1,
    progress: ProgressCallback | None = None,
) -> tuple[EmbeddedChunk, ...]:
    materialized = tuple(chunks)
    if preflight:
        preflight_embedding_inputs(
            materialized,
            provider,
            model_input_limit,
            workers=workers,
        )

    def embed(chunk: Chunk) -> EmbeddedChunk:
        embedding = provider.embed_document(chunk.embedding_text)
        if len(embedding) != provider.dimensions:
            raise RuntimeError(
                f"Embedding provider returned {len(embedding)} dimensions; "
                f"expected {provider.dimensions}"
            )
        return EmbeddedChunk(chunk=chunk, embedding=embedding)

    embedded = []
    for completed, item in enumerate(
        _bounded_map(embed, materialized, workers),
        start=1,
    ):
        embedded.append(item)
        if progress is not None:
            progress(completed, len(materialized))
    return tuple(embedded)


def _normalize_l2(values: Iterable[float]) -> tuple[float, ...]:
    vector = tuple(float(value) for value in values)
    if not all(math.isfinite(value) for value in vector):
        raise RuntimeError("Vertex AI returned a non-finite embedding value")
    norm = math.sqrt(math.fsum(value * value for value in vector))
    if norm == 0:
        raise RuntimeError("Vertex AI returned a zero-length embedding vector")
    return tuple(value / norm for value in vector)


def _bounded_map(
    function: Callable[[Input], Output], inputs: Iterable[Input], workers: int
) -> Iterable[Output]:
    if workers <= 0:
        raise ValueError("embedding workers must be positive")
    if workers == 1:
        return map(function, inputs)
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="vertex-embedding")

    def results() -> Iterable[Output]:
        try:
            yield from executor.map(function, inputs, buffersize=workers)
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    return results()
