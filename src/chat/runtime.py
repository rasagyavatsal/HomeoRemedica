from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import requests
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from chat.chat import ChatService
from chat.corpus import CorpusRelease, load_local_corpus
from corpus.embeddings import (
    QWEN3_EMBEDDING_MODEL,
    EmbeddingSpec,
    OpenRouterEmbeddingProvider,
)

DEFAULT_ZAI_BASE_URL = "https://api.z.ai/api/paas/v4"
ZAI_API_KEY_ENV = "ZAI_API_KEY"
ZAI_REQUEST_TIMEOUT = 60.0


def _default_corpus_dir() -> Path:
    return Path("artifacts/corpus")


class Settings(BaseSettings):
    """Configuration for the local web service.

    Values can be passed as ``RAG_*`` environment variables or placed in a
    ``.env``/``.env.local`` file. The Z.AI and OpenRouter API keys use their
    provider-specific environment variable names.
    """

    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=(".env", ".env.local"),
        extra="ignore",
    )

    corpus_dir: Path = Field(default_factory=_default_corpus_dir)
    model: str = "glm-5.3-flash"
    max_output_tokens: int = Field(default=700, gt=0, le=4_096)
    zai_api_key: str | None = Field(default=None, validation_alias=ZAI_API_KEY_ENV)
    openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")

    @field_validator("corpus_dir", mode="before")
    @classmethod
    def expand_corpus_dir(cls, value: str | os.PathLike[str]) -> Path:
        return Path(value).expanduser()


class HybridChatModel:
    """Hide Z.AI generation and OpenRouter query embeddings behind the chat protocol."""

    def __init__(
        self,
        *,
        model: str,
        max_output_tokens: int,
        embedding_model: str,
        embedding_dimensions: int,
        zai_api_key: str | None = None,
        openrouter_api_key: str | None = None,
        client: Any | None = None,
        generation_session: Any | None = None,
        embedding_session: Any | None = None,
    ) -> None:
        self.model = model
        self._client = client or ZaiChatClient(
            api_key=zai_api_key,
            model=model,
            max_output_tokens=max_output_tokens,
            session=generation_session,
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
        return self._client.generate(prompt, system_instruction=system_instruction)


class ZaiChatClient:
    """Call Z.AI's OpenAI-compatible chat completion endpoint."""

    def __init__(
        self,
        *,
        api_key: str | None,
        model: str,
        max_output_tokens: int,
        base_url: str = DEFAULT_ZAI_BASE_URL,
        session: Any | None = None,
        timeout: float = ZAI_REQUEST_TIMEOUT,
    ) -> None:
        resolved_key = _resolve_zai_api_key(api_key)
        if not resolved_key:
            raise ValueError(
                f"a Z.AI API key is required; set {ZAI_API_KEY_ENV} in the environment or .env"
            )
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._base_url = base_url.rstrip("/")
        self._session = session or requests.Session()
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {resolved_key}",
            "Content-Type": "application/json",
        }

    def generate(self, prompt: str, *, system_instruction: str) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": prompt},
            ],
            "thinking": {"type": "enabled"},
            "reasoning_effort": "max",
            "temperature": 1.0,
            "max_tokens": self._max_output_tokens,
            "stream": False,
        }
        try:
            response = self._session.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers,
                json=payload,
                timeout=self._timeout,
            )
        except (requests.Timeout, TimeoutError):
            raise TimeoutError("Z.AI chat request timed out") from None
        except requests.RequestException:
            raise RuntimeError("Z.AI chat request failed") from None
        if response.status_code != 200:
            if response.status_code in {408, 504}:
                raise TimeoutError("Z.AI chat request timed out") from None
            raise RuntimeError(
                "Z.AI chat request failed with status "
                f"{response.status_code}"
            ) from None
        try:
            parsed = response.json()
        except ValueError:
            raise RuntimeError("Z.AI returned an invalid JSON chat response") from None
        if not isinstance(parsed, dict):
            raise RuntimeError("Z.AI returned an unexpected chat response shape")
        choices = parsed.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise RuntimeError("Z.AI returned no chat choices")
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise RuntimeError("Z.AI returned an invalid chat message")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("Z.AI returned an empty chat response")
        return content


def _resolve_zai_api_key(api_key: str | None) -> str | None:
    if api_key:
        return api_key
    if key := os.environ.get(ZAI_API_KEY_ENV):
        return key
    for name in (".env.local", ".env"):
        try:
            lines = Path(name).read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            stripped = line.strip()
            if stripped.startswith("export "):
                stripped = stripped[len("export ") :].strip()
            if stripped.startswith(f"{ZAI_API_KEY_ENV}="):
                value = stripped.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    return None


def build_service(settings: Settings) -> ChatService:
    corpus = load_corpus(settings)
    embedding_model = corpus.embedding_model
    if embedding_model != QWEN3_EMBEDDING_MODEL:
        raise ValueError(
            f"corpus was built with {embedding_model}; this client embeds queries with "
            f"{QWEN3_EMBEDDING_MODEL}. Build or point RAG_CORPUS_DIR at a supported release."
        )
    model = HybridChatModel(
        model=settings.model,
        max_output_tokens=settings.max_output_tokens,
        embedding_model=embedding_model,
        embedding_dimensions=corpus.embedding_dimensions,
        zai_api_key=settings.zai_api_key,
        openrouter_api_key=settings.openrouter_api_key,
    )
    return ChatService(
        corpus=corpus,
        model=model,
        embedding_dimensions=corpus.embedding_dimensions,
        query_task_type=corpus.query_task_type,
    )


def load_corpus(settings: Settings) -> CorpusRelease:
    """Load and verify the active local release used by the web service."""
    return load_local_corpus(settings.corpus_dir)
