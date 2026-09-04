from __future__ import annotations

import math
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from homeoremedica_chat.chat import ChatService
from homeoremedica_chat.corpus import CorpusCache, CorpusRelease, GoogleCloudCorpusSource


def _default_cache_dir() -> Path:
    cache_home = os.environ.get("XDG_CACHE_HOME")
    if cache_home:
        return Path(cache_home).expanduser() / "homeoremedica" / "corpus"
    return Path.home() / ".cache" / "homeoremedica" / "corpus"


class Settings(BaseSettings):
    """Configuration for the local terminal client.

    Values can be passed as ``RAG_*`` environment variables or placed in a
    ``.env``/``.env.local`` file. Google authentication is intentionally left
    to Application Default Credentials instead of being stored by the CLI.
    """

    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=(".env", ".env.local"),
        extra="ignore",
    )

    project: str = "homeoremedica"
    location: str = "us-central1"
    bucket: str = "homeoremedica-private-remedies"
    corpus_prefix: str = "corpora"
    cache_dir: Path = Field(default_factory=_default_cache_dir)
    model: str = "gemini-2.5-flash-lite"
    max_output_tokens: int = Field(default=700, gt=0, le=4_096)

    @field_validator("cache_dir", mode="before")
    @classmethod
    def expand_cache_dir(cls, value: str | os.PathLike[str]) -> Path:
        return Path(value).expanduser()


VERTEX_REQUEST_TIMEOUT_MS = 30_000


class VertexChatModel:
    """Hide Vertex AI embedding and generation calls behind the chat protocol."""

    def __init__(
        self,
        *,
        project: str,
        location: str,
        model: str,
        max_output_tokens: int,
        client: Any | None = None,
    ) -> None:
        self.model = model
        self._max_output_tokens = max_output_tokens
        self._client = client or genai.Client(
            vertexai=True,
            project=project,
            location=location,
            http_options=types.HttpOptions(
                timeout=VERTEX_REQUEST_TIMEOUT_MS,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )

    def embed_query(self, text: str, *, dimensions: int, task_type: str) -> tuple[float, ...]:
        response = self._client.models.embed_content(
            model="gemini-embedding-001",
            contents=text,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=dimensions,
                auto_truncate=False,
            ),
        )
        embeddings = response.embeddings or []
        if len(embeddings) != 1:
            raise RuntimeError(f"Vertex AI returned {len(embeddings)} query embeddings")
        result = embeddings[0]
        if result.statistics is not None and result.statistics.truncated:
            raise RuntimeError("Vertex AI truncated the retrieval query")
        return _normalize(result.values or (), dimensions)

    def generate(self, prompt: str, *, system_instruction: str) -> str:
        response = self._client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.2,
                max_output_tokens=self._max_output_tokens,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        if not response.text or not response.text.strip():
            raise RuntimeError("Vertex AI returned an empty chat response")
        return response.text


def build_service(settings: Settings, *, sync: bool = True) -> ChatService:
    cache = CorpusCache(settings.cache_dir, prefix=settings.corpus_prefix)
    corpus = sync_corpus(settings) if sync else cache.open_cached()
    model = VertexChatModel(
        project=settings.project,
        location=settings.location,
        model=settings.model,
        max_output_tokens=settings.max_output_tokens,
    )
    return ChatService(
        corpus=corpus,
        model=model,
        embedding_dimensions=corpus.embedding_dimensions,
        query_task_type=corpus.query_task_type,
    )


def sync_corpus(settings: Settings) -> CorpusRelease:
    return CorpusCache(settings.cache_dir, prefix=settings.corpus_prefix).sync(
        GoogleCloudCorpusSource(settings.bucket, project=settings.project)
    )


def _normalize(values: Sequence[float], dimensions: int) -> tuple[float, ...]:
    if len(values) != dimensions:
        raise RuntimeError(
            f"Vertex AI returned {len(values)} embedding dimensions; expected {dimensions}"
        )
    norm = math.sqrt(math.fsum(float(value) ** 2 for value in values))
    if norm == 0 or not math.isfinite(norm):
        raise RuntimeError("Vertex AI returned a zero or non-finite query embedding")
    return tuple(float(value) / norm for value in values)
