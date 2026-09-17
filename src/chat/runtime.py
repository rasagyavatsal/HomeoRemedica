"""Build the production chat service from the active corpus release."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from chat.corpus import CorpusRelease, load_local_corpus
from chat.retrieval import ProductionRetriever
from corpus.embeddings import QWEN3_EMBEDDING_MODEL, EmbeddingSpec, OpenRouterEmbeddingProvider
from shared.generation import ZaiChatClient
from shared.service import ChatService


def _default_corpus_dir() -> Path:
    return Path("artifacts/corpus")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=(".env", ".env.local"),
        extra="ignore",
    )

    corpus_dir: Path = Field(default_factory=_default_corpus_dir)
    model: str = "glm-5.3-flash"
    max_output_tokens: int = Field(default=4_096, gt=0, le=4_096)
    zai_api_key: str | None = Field(default=None, validation_alias="ZAI_API_KEY")
    openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")

    @field_validator("corpus_dir", mode="before")
    @classmethod
    def expand_corpus_dir(cls, value: str | os.PathLike[str]) -> Path:
        return Path(value).expanduser()


def build_service(settings: Settings) -> ChatService:
    corpus = load_corpus(settings)
    if corpus.embedding_model != QWEN3_EMBEDDING_MODEL:
        raise ValueError(
            f"corpus was built with {corpus.embedding_model}; this client embeds queries with "
            f"{QWEN3_EMBEDDING_MODEL}. Build or point RAG_CORPUS_DIR at a supported release."
        )
    embedder = OpenRouterEmbeddingProvider(
        EmbeddingSpec(model=corpus.embedding_model, dimensions=corpus.embedding_dimensions),
        api_key=settings.openrouter_api_key,
    )
    generator = ZaiChatClient(
        api_key=settings.zai_api_key,
        model=settings.model,
        max_output_tokens=settings.max_output_tokens,
    )
    return ChatService(retriever=ProductionRetriever(corpus, embedder), generator=generator)


def load_corpus(settings: Settings) -> CorpusRelease:
    return load_local_corpus(settings.corpus_dir)
