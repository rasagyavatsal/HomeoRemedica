from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import sleep

import pytest
import requests

from homeoremedica_corpus import embeddings as embeddings_module
from homeoremedica_corpus.chunking import ChunkingPolicy, chunk_book
from homeoremedica_corpus.embeddings import (
    EmbeddingSpec,
    OpenRouterEmbeddingProvider,
    embed_chunks,
    preflight_embedding_inputs,
)
from homeoremedica_corpus.sources import Book, CorpusValidationError, Remedy, Section


def chunks_with(*passages: str):
    book = Book(
        book_id="book",
        title="Book Title",
        author=None,
        source_path=Path("book.json"),
        source_sha256="a" * 64,
        remedies=(Remedy(name="Remedy", sections=(Section(title="Mind", passages=passages),)),),
    )
    return chunk_book(
        book,
        ChunkingPolicy(target_tokens=1, minimum_tokens=1),
        lambda text: len(text.split()),
    )


@dataclass
class RecordingProvider:
    token_counts: dict[str, int]
    dimensions: int = 2

    def __post_init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def count_tokens(self, text: str) -> int:
        self.events.append(("count", text))
        return self.token_counts.get(text, 1)

    def embed_document(self, text: str) -> tuple[float, ...]:
        self.events.append(("embed_document", text))
        return (1.0, 0.0)

    def embed_query(self, text: str) -> tuple[float, ...]:
        self.events.append(("embed_query", text))
        return (0.0, 1.0)


def test_preflights_every_input_before_embedding_any_chunk() -> None:
    chunks = chunks_with("first", "second")
    provider = RecordingProvider({chunks[1].embedding_text: 11})

    with pytest.raises(CorpusValidationError) as error:
        embed_chunks(chunks, provider, model_input_limit=10)

    assert "book / Remedy / Mind / passage 1" in str(error.value)
    assert [event for event, _ in provider.events] == ["count", "count"]


def test_preflight_and_embedding_preserve_chunk_order() -> None:
    chunks = chunks_with("first", "second")
    provider = RecordingProvider({})

    preflight_embedding_inputs(chunks, provider, model_input_limit=10)
    embedded = embed_chunks(chunks, provider, model_input_limit=10, preflight=False)

    assert [item.chunk for item in embedded] == list(chunks)
    assert [item.embedding for item in embedded] == [(1.0, 0.0), (1.0, 0.0)]
    assert [event for event, _ in provider.events] == [
        "count",
        "count",
        "embed_document",
        "embed_document",
    ]


def test_parallel_embedding_preserves_chunk_order() -> None:
    chunks = chunks_with("first", "second")
    provider = RecordingProvider({})
    original_embed = provider.embed_document

    def delayed_embed(text: str) -> tuple[float, ...]:
        if text.endswith("first"):
            sleep(0.01)
        return original_embed(text)

    provider.embed_document = delayed_embed  # type: ignore[method-assign]
    embedded = embed_chunks(
        chunks,
        provider,
        model_input_limit=10,
        preflight=False,
        workers=2,
    )

    assert [item.chunk for item in embedded] == list(chunks)


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        payload: object = None,
        text: str = "",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self.headers = headers or {}

    def json(self) -> object:
        if self._payload == "invalid":
            raise ValueError("not JSON")
        return self._payload


class FakeSession:
    def __init__(self, responses: list[FakeResponse | Exception]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, object]] = []

    def post(self, url: str, **kwargs: object) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def embedding_payload(values: list[float], prompt_tokens: int = 7) -> dict[str, object]:
    return {
        "data": [{"embedding": values, "index": 0}],
        "usage": {"prompt_tokens": prompt_tokens, "total_tokens": prompt_tokens},
    }


def provider(session: FakeSession) -> OpenRouterEmbeddingProvider:
    spec = EmbeddingSpec(dimensions=2, native_dimensions=4)
    return OpenRouterEmbeddingProvider(spec, api_key="test-key", session=session)


def resolving_provider(session: FakeSession) -> OpenRouterEmbeddingProvider:
    spec = EmbeddingSpec(dimensions=2, native_dimensions=4)
    return OpenRouterEmbeddingProvider(spec, session=session)


def test_provider_requires_an_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        resolving_provider(FakeSession([]))


def test_provider_falls_back_to_a_dotenv_file_in_the_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("OPENROUTER_API_KEY=dotenv-key\n")
    session = FakeSession([FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0]))])

    resolving_provider(session).embed_query("query")

    assert session.calls[0]["headers"] == {"Authorization": "Bearer dotenv-key"}


def test_provider_prefers_env_local_over_dotenv_and_the_environment_over_both(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("OPENROUTER_API_KEY=base-key\n")
    (tmp_path / ".env.local").write_text("OPENROUTER_API_KEY=local-key\n")
    session = FakeSession([FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0]))])

    resolving_provider(session).embed_query("query")
    assert session.calls[0]["headers"] == {"Authorization": "Bearer local-key"}

    monkeypatch.setenv("OPENROUTER_API_KEY", "env-key")
    session = FakeSession([FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0]))])
    resolving_provider(session).embed_query("query")
    assert session.calls[0]["headers"] == {"Authorization": "Bearer env-key"}


def test_provider_prefers_the_explicit_api_key_over_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "env-key")
    session = FakeSession([FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0]))])
    embeddings = OpenRouterEmbeddingProvider(
        EmbeddingSpec(dimensions=2, native_dimensions=4),
        api_key="explicit-key",
        session=session,
    )

    embeddings.embed_query("query")

    assert session.calls[0]["headers"] == {"Authorization": "Bearer explicit-key"}


def test_provider_sends_the_openai_compatible_contract_and_truncates_mrl_prefixes() -> None:
    session = FakeSession([FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0]))])

    vector = provider(session).embed_document("labelled document")

    assert vector == pytest.approx((0.6, 0.8))
    assert len(session.calls) == 1
    call = session.calls[0]
    assert call["url"] == "https://openrouter.ai/api/v1/embeddings"
    assert call["headers"] == {"Authorization": "Bearer test-key"}
    assert call["json"] == {
        "model": "qwen/qwen3-embedding-8b",
        "input": "labelled document",
        "encoding_format": "float",
    }
    assert call["timeout"] == 60.0


def test_provider_counts_tokens_with_the_conservative_character_bound() -> None:
    counted = provider(FakeSession([]))

    assert counted.count_tokens("") == 0
    assert counted.count_tokens("x" * 9) == 3


def test_provider_rejects_invalid_responses() -> None:
    cases = [
        (
            FakeSession([FakeResponse(payload={"data": []})]),
            "exactly one embedding",
        ),
        (
            FakeSession([
                FakeResponse(
                    payload={"data": [{"embedding": [3.0, 4.0]}, {"embedding": [5.0, 6.0]}]}
                )
            ]),
            "exactly one embedding",
        ),
        (
            FakeSession([FakeResponse(payload={"data": [{"embedding": [3.0, 4.0]}]})]),
            "wrong embedding dimensions",
        ),
        (
            FakeSession([FakeResponse(payload={"data": [{"embedding": "base64"}]})]),
            "non-list embedding vector",
        ),
        (
            FakeSession([FakeResponse(payload=embedding_payload([0.0, 0.0, 0.0, 0.0]))]),
            "zero-length",
        ),
    ]
    for session, message in cases:
        with pytest.raises(RuntimeError, match=message):
            provider(session).embed_document("text")


def test_provider_rejects_an_input_above_the_model_token_limit() -> None:
    session = FakeSession([FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0]))])
    spec = EmbeddingSpec(dimensions=2, native_dimensions=4, model_input_limit=6)

    with pytest.raises(RuntimeError, match="7 tokens, above the 6 token"):
        OpenRouterEmbeddingProvider(spec, api_key="test-key", session=session).embed_document(
            "text"
        )


def test_provider_ignores_a_missing_or_malformed_usage_report() -> None:
    session = FakeSession([FakeResponse(payload={"data": [{"embedding": [3.0, 4.0, 5.0, 6.0]}]})])

    vector = provider(session).embed_document("text")

    assert vector == pytest.approx((0.6, 0.8))


def test_provider_wraps_transport_and_permanent_http_failures() -> None:
    transport = FakeSession([requests.ConnectionError("dns failure")] * 3)
    with pytest.raises(RuntimeError, match="OpenRouter embeddings request failed"):
        provider(transport).embed_document("text")

    forbidden = FakeSession([FakeResponse(status_code=401, text="missing credentials")])
    with pytest.raises(RuntimeError, match=r"status 401.*missing credentials"):
        provider(forbidden).embed_document("text")

    invalid = FakeSession([FakeResponse(payload="invalid")])
    with pytest.raises(RuntimeError, match="invalid JSON embedding response"):
        provider(invalid).embed_document("text")


def test_provider_retries_retryable_statuses_and_respects_retry_after(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delays: list[float] = []
    monkeypatch.setattr(embeddings_module.time, "sleep", delays.append)
    session = FakeSession([
        FakeResponse(status_code=429, text="rate limited", headers={"Retry-After": "2"}),
        FakeResponse(payload=embedding_payload([3.0, 4.0, 5.0, 6.0])),
    ])

    vector = provider(session).embed_document("text")

    assert vector == pytest.approx((0.6, 0.8))
    assert delays == [2.0]
    assert len(session.calls) == 2


def test_provider_gives_up_after_the_retry_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(embeddings_module.time, "sleep", lambda _delay: None)
    session = FakeSession(
        [FakeResponse(status_code=503, text="upstream overloaded")] * 3,
    )

    with pytest.raises(RuntimeError, match=r"failed after 3 attempts.*503"):
        provider(session).embed_document("text")

    assert len(session.calls) == 3
