from __future__ import annotations

import math
import os
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, TypeVar

import requests

from homeoremedica_corpus.chunking import Chunk
from homeoremedica_corpus.sources import CorpusValidationError

QWEN3_EMBEDDING_MODEL = "qwen/qwen3-embedding-8b"
QWEN3_NATIVE_DIMENSIONS = 4096
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY"

# OpenRouter has no token-counting endpoint for embeddings, so preflight uses
# the same conservative four-characters-per-token bound as the chat client.
_ESTIMATED_CHARS_PER_TOKEN = 4

_RETRYABLE_STATUS_CODES = frozenset({408, 409, 429, 500, 502, 503, 504})
_MAX_ATTEMPTS = 3
_INITIAL_BACKOFF_SECONDS = 1.0

# Mirrors the chat client's SettingsConfigDict env_file order: the real
# environment wins, then .env.local overrides .env.
_DOTENV_FILES = (".env.local", ".env")


@dataclass(frozen=True, slots=True)
class EmbeddingSpec:
    model: str = QWEN3_EMBEDDING_MODEL
    dimensions: int = 768
    native_dimensions: int = QWEN3_NATIVE_DIMENSIONS
    document_task_type: str = "RETRIEVAL_DOCUMENT"
    query_task_type: str = "RETRIEVAL_QUERY"
    normalization: str = "l2"
    distance_function: str = "cosine"
    model_input_limit: int = 32_768

    def __post_init__(self) -> None:
        if self.native_dimensions <= 0:
            raise ValueError("embedding native dimensions must be positive")
        if not 1 <= self.dimensions <= self.native_dimensions:
            raise ValueError(
                "embedding dimensions must be between 1 and the model's "
                f"{self.native_dimensions} native dimensions"
            )
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


class OpenRouterEmbeddingProvider:
    """OpenRouter embedding access with truncation and normalization hidden from callers.

    Qwen3 embeddings are always requested at the model's native dimensionality
    and reduced to the configured Matryoshka prefix locally, so every OpenRouter
    upstream provider serves identical vectors whether or not it honors a
    ``dimensions`` request parameter.
    """

    def __init__(
        self,
        spec: EmbeddingSpec,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_OPENROUTER_BASE_URL,
        session: Any | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.spec = spec
        self.dimensions = spec.dimensions
        resolved_key = _resolve_api_key(api_key)
        if not resolved_key:
            raise ValueError(
                f"an OpenRouter API key is required; set {OPENROUTER_API_KEY_ENV} "
                "in the environment or .env"
            )
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._session = session or requests.Session()
        self._headers = {"Authorization": f"Bearer {resolved_key}"}

    def count_tokens(self, text: str) -> int:
        return math.ceil(len(text) / _ESTIMATED_CHARS_PER_TOKEN)

    def embed_document(self, text: str) -> tuple[float, ...]:
        # OpenRouter's embeddings API has no task conditioning; the configured
        # task types are compatibility metadata recorded in corpus artifacts.
        return self._embed(text)

    def embed_query(self, text: str) -> tuple[float, ...]:
        return self._embed(text)

    def _embed(self, text: str) -> tuple[float, ...]:
        response = self._request({
            "model": self.spec.model,
            "input": text,
            "encoding_format": "float",
        })
        _reject_oversized_input(response, self.spec.model_input_limit)
        data = response.get("data")
        if not isinstance(data, list) or len(data) != 1:
            raise RuntimeError("OpenRouter did not return exactly one embedding for one input")
        embedding = data[0].get("embedding") if isinstance(data[0], dict) else None
        if not isinstance(embedding, list):
            raise RuntimeError("OpenRouter returned a missing or non-list embedding vector")
        if len(embedding) != self.spec.native_dimensions:
            raise RuntimeError(
                "OpenRouter returned the wrong embedding dimensions "
                f"(expected {self.spec.native_dimensions}, got {len(embedding)})"
            )
        if self.spec.dimensions < self.spec.native_dimensions:
            embedding = embedding[: self.spec.dimensions]
        return _normalize_l2(embedding)

    def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self._base_url}/embeddings"
        backoff = _INITIAL_BACKOFF_SECONDS
        last_error: RuntimeError | None = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = self._session.post(
                    url,
                    headers=self._headers,
                    json=payload,
                    timeout=self._timeout,
                )
            except requests.RequestException as error:
                last_error = RuntimeError(f"OpenRouter embeddings request failed: {error}")
                delay = backoff
            else:
                if response.status_code == 200:
                    return _parse_embedding_response(response)
                last_error = RuntimeError(
                    "OpenRouter embeddings request failed with status "
                    f"{response.status_code}: {_response_snippet(response)}"
                )
                if response.status_code not in _RETRYABLE_STATUS_CODES:
                    raise last_error
                delay = _retry_after_seconds(response) or backoff
            if attempt < _MAX_ATTEMPTS:
                time.sleep(delay)
                backoff *= 2
        raise RuntimeError(
            f"OpenRouter embeddings request failed after {_MAX_ATTEMPTS} attempts: {last_error}"
        ) from last_error


def _resolve_api_key(api_key: str | None) -> str | None:
    if api_key:
        return api_key
    key = os.environ.get(OPENROUTER_API_KEY_ENV)
    if key:
        return key
    for name in _DOTENV_FILES:
        value = _read_dotenv_key(Path(name), OPENROUTER_API_KEY_ENV)
        if value:
            return value
    return None


def _read_dotenv_key(path: Path, name: str) -> str | None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        stripped = line.strip()
        if stripped.startswith("export "):
            stripped = stripped[len("export ") :].strip()
        if not stripped.startswith(f"{name}="):
            continue
        value = stripped.split("=", 1)[1].strip().strip('"').strip("'")
        if value:
            return value
    return None


def _parse_embedding_response(response: Any) -> dict[str, Any]:
    try:
        parsed = response.json()
    except ValueError as error:
        raise RuntimeError("OpenRouter returned an invalid JSON embedding response") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("OpenRouter returned an unexpected embedding response shape")
    return parsed


def _reject_oversized_input(response: dict[str, Any], model_input_limit: int) -> None:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return
    prompt_tokens = usage.get("prompt_tokens")
    if isinstance(prompt_tokens, bool) or not isinstance(prompt_tokens, int):
        return
    if prompt_tokens > model_input_limit:
        raise RuntimeError(
            f"OpenRouter embedded an input of {prompt_tokens} tokens, above the "
            f"{model_input_limit} token model input limit"
        )


def _retry_after_seconds(response: Any) -> float | None:
    try:
        delay = float(response.headers.get("Retry-After"))
    except (TypeError, ValueError):
        return None
    return delay if delay >= 0 else None


def _response_snippet(response: Any) -> str:
    return str(response.text)[:200]


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
        raise RuntimeError("the embedding provider returned a non-finite embedding value")
    norm = math.sqrt(math.fsum(value * value for value in vector))
    if norm == 0:
        raise RuntimeError("the embedding provider returned a zero-length embedding vector")
    return tuple(value / norm for value in vector)


def _bounded_map(
    function: Callable[[Input], Output], inputs: Iterable[Input], workers: int
) -> Iterable[Output]:
    if workers <= 0:
        raise ValueError("embedding workers must be positive")
    if workers == 1:
        return map(function, inputs)
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="openrouter-embedding")

    def results() -> Iterable[Output]:
        try:
            yield from executor.map(function, inputs, buffersize=workers)
        finally:
            executor.shutdown(wait=True, cancel_futures=True)

    return results()
