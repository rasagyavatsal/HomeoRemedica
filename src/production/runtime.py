"""Build the production chat service from the Qdrant collection."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from qdrant_client import QdrantClient

from production.embeddings import VoyageQueryEmbedder
from production.qdrant import COLLECTION, Bm25QueryEncoder, QdrantCorpus
from production.retrieval import ProductionRetriever
from shared.generation import ZaiChatClient
from shared.service import ChatService

QDRANT_TIMEOUT_SECONDS = 30


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=(".env", ".env.local"),
        extra="ignore",
    )

    qdrant_url: str | None = Field(default=None, validation_alias="QDRANT_URL")
    qdrant_api_key: str | None = Field(default=None, validation_alias="QDRANT_API_KEY")
    qdrant_collection: str = COLLECTION
    model: str = "glm-5.3-flash"
    max_output_tokens: int = Field(default=4_096, gt=0, le=4_096)
    zai_api_key: str | None = Field(default=None, validation_alias="ZAI_API_KEY")
    openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")


def build_service(settings: Settings) -> ChatService:
    embedder = VoyageQueryEmbedder(api_key=settings.openrouter_api_key)
    generator = ZaiChatClient(
        api_key=settings.zai_api_key,
        model=settings.model,
        max_output_tokens=settings.max_output_tokens,
    )
    corpus = load_corpus(settings)
    corpus.verify()
    return ChatService(retriever=ProductionRetriever(corpus, embedder), generator=generator)


def load_corpus(settings: Settings) -> QdrantCorpus:
    if not settings.qdrant_url:
        raise ValueError("a Qdrant URL is required; set QDRANT_URL in the environment or .env")
    client = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=QDRANT_TIMEOUT_SECONDS,
    )
    return QdrantCorpus(client, Bm25QueryEncoder(), collection=settings.qdrant_collection)
