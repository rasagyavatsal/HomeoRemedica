from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import sleep
from types import SimpleNamespace

import pytest

from homeoremedica_corpus.chunking import ChunkingPolicy, chunk_book
from homeoremedica_corpus.embeddings import (
    EmbeddingSpec,
    VertexEmbeddingProvider,
    _VertexTokenCounter,
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


class ModelsClient:
    def __init__(self) -> None:
        self.embed_calls: list[dict[str, object]] = []

    def embed_content(self, **kwargs: object) -> SimpleNamespace:
        self.embed_calls.append(kwargs)
        embedding = SimpleNamespace(
            values=[3.0, 4.0],
            statistics=SimpleNamespace(truncated=False, token_count=7),
        )
        return SimpleNamespace(embeddings=[embedding])


class RecordingSession:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def post(self, url: str, **kwargs: object) -> SimpleNamespace:
        self.calls.append({"url": url, **kwargs})
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"totalTokens": 7},
        )


def test_vertex_token_counter_uses_embedding_instances_contract() -> None:
    session = RecordingSession()
    counter = _VertexTokenCounter(
        project="project-id",
        location="us-central1",
        model="gemini-embedding-001",
        session=session,
    )

    assert counter("count me") == 7
    assert session.calls == [
        {
            "url": (
                "https://us-central1-aiplatform.googleapis.com/v1/projects/project-id/"
                "locations/us-central1/publishers/google/models/"
                "gemini-embedding-001:countTokens"
            ),
            "json": {"instances": [{"content": "count me"}]},
            "timeout": 60,
        }
    ]


def test_vertex_token_counter_requires_a_regional_endpoint() -> None:
    with pytest.raises(ValueError, match=r"regional.*us-central1"):
        _VertexTokenCounter(
            project="project-id",
            location="global",
            model="gemini-embedding-001",
            session=RecordingSession(),
        )


def test_vertex_provider_disables_truncation_and_l2_normalizes() -> None:
    models = ModelsClient()
    counted: list[str] = []

    def count_tokens(text: str) -> int:
        counted.append(text)
        return 7

    provider = VertexEmbeddingProvider(
        EmbeddingSpec(dimensions=2),
        client=SimpleNamespace(models=models),
        token_counter=count_tokens,
    )

    assert provider.count_tokens("count me") == 7
    vector = provider.embed_document("labelled document")

    assert vector == pytest.approx((0.6, 0.8))
    assert counted == ["count me"]
    call = models.embed_calls[0]
    assert call["model"] == "gemini-embedding-001"
    assert call["contents"] == "labelled document"
    config = call["config"]
    assert config.task_type == "RETRIEVAL_DOCUMENT"
    assert config.output_dimensionality == 2
    assert config.auto_truncate is False


def test_vertex_provider_rejects_truncation_wrong_dimensions_and_zero_vectors() -> None:
    class InvalidModels(ModelsClient):
        def __init__(self, values: list[float], truncated: bool = False) -> None:
            super().__init__()
            self.values = values
            self.truncated = truncated

        def embed_content(self, **kwargs: object) -> SimpleNamespace:
            embedding = SimpleNamespace(
                values=self.values,
                statistics=SimpleNamespace(truncated=self.truncated, token_count=20),
            )
            return SimpleNamespace(embeddings=[embedding])

    for models, message in [
        (InvalidModels([1.0], truncated=True), "truncated"),
        (InvalidModels([1.0]), "dimensions"),
        (InvalidModels([0.0, 0.0]), "zero-length"),
    ]:
        provider = VertexEmbeddingProvider(
            EmbeddingSpec(dimensions=2),
            client=SimpleNamespace(models=models),
            token_counter=lambda _text: 1,
        )
        with pytest.raises(RuntimeError, match=message):
            provider.embed_document("text")
