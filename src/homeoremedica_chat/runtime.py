from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from homeoremedica_chat.chat import ChatService
from homeoremedica_chat.corpus import CorpusCache, CorpusRelease, GoogleCloudCorpusSource
from homeoremedica_corpus.embeddings import (
    QWEN3_EMBEDDING_MODEL,
    EmbeddingSpec,
    OpenRouterEmbeddingProvider,
)


def _default_cache_dir() -> Path:
    cache_home = os.environ.get("XDG_CACHE_HOME")
    if cache_home:
        return Path(cache_home).expanduser() / "homeoremedica" / "corpus"
    return Path.home() / ".cache" / "homeoremedica" / "corpus"


class Settings(BaseSettings):
    """Configuration for the local terminal client.

    Values can be passed as ``RAG_*`` environment variables or placed in a
    ``.env``/``.env.local`` file. Generation authentication is intentionally
    left to Application Default Credentials instead of being stored by the CLI;
    query embeddings authenticate with ``OPENROUTER_API_KEY``.
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
    openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")

    @field_validator("cache_dir", mode="before")
    @classmethod
    def expand_cache_dir(cls, value: str | os.PathLike[str]) -> Path:
        return Path(value).expanduser()


VERTEX_REQUEST_TIMEOUT_MS = 30_000


class HybridChatModel:
    """Hide Vertex AI generation and OpenRouter query embeddings behind the chat protocol."""

    def __init__(
        self,
        *,
        project: str,
        location: str,
        model: str,
        max_output_tokens: int,
        embedding_model: str,
        embedding_dimensions: int,
        openrouter_api_key: str | None = None,
        client: Any | None = None,
        embedding_session: Any | None = None,
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
        self._embeddings = OpenRouterEmbeddingProvider(
            EmbeddingSpec(
                model=embedding_model,
                dimensions=embedding_dimensions,
            ),
            api_key=openrouter_api_key,
            session=embedding_session,
        )

    def embed_query(self, text: str, *, dimensions: int, task_type: str) -> tuple[float, ...]:
        if dimensions != self._embeddings.dimensions:
            raise RuntimeError(
                f"corpus requests {dimensions} query embedding dimensions; "
                f"this client embeds with {self._embeddings.dimensions}"
            )
        # OpenRouter's embeddings API has no task conditioning; the corpus task
        # type is compatibility metadata recorded in the release manifest.
        return self._embeddings.embed_query(text)

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
    embedding_model = corpus.embedding_model
    if embedding_model != QWEN3_EMBEDDING_MODEL:
        raise ValueError(
            f"corpus was built with {embedding_model}; this client embeds queries with "
            f"{QWEN3_EMBEDDING_MODEL}. Sync a corpus release built with the supported model."
        )
    model = HybridChatModel(
        project=settings.project,
        location=settings.location,
        model=settings.model,
        max_output_tokens=settings.max_output_tokens,
        embedding_model=embedding_model,
        embedding_dimensions=corpus.embedding_dimensions,
        openrouter_api_key=settings.openrouter_api_key,
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
