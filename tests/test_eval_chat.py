from __future__ import annotations

import io
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from corpus.chunking import ChunkingPolicy, chunk_book
from corpus.sources import Book, Remedy, Section
from eval_chat.chat_cli import main
from eval_chat.chat_config import EvalChatConfig, load_chat_config
from eval_chat.chat_retrieval import ExperimentalRetriever
from eval_chat.chat_runtime import build_service
from eval_chat.config import load_evaluation_config
from eval_chat.evaluation import EvaluationSettings
from eval_chat.retrieval import (
    PreparedRetrievalIndex,
    score_lexical_queries,
    score_semantic_queries,
)
from shared.contracts import ChatRequest, ChatResponse

ROOT = Path(__file__).resolve().parents[1]


def _books() -> tuple[Book, ...]:
    return tuple(
        Book(
            book_id=name,
            title=f"Book {name}",
            author=f"Author {name}",
            source_path=Path(f"{name}.json"),
            source_sha256="a" * 64,
            remedies=(
                Remedy(
                    name=name.upper(),
                    sections=(Section(title="MIND", passages=(f"{name} evidence",)),),
                ),
            ),
        )
        for name in ("alpha", "beta")
    )


class FakeEmbedder:
    dimensions = 2

    def __init__(self) -> None:
        self.queries: list[str] = []
        self.document_calls = 0

    def count_tokens(self, text: str) -> int:
        return 2

    def embed_document(self, text: str) -> tuple[float, float]:
        self.document_calls += 1
        return (1.0, 0.0) if "Text: alpha evidence" in text else (0.0, 1.0)

    def embed_documents(self, texts: tuple[str, ...]) -> tuple[tuple[float, float], ...]:
        return tuple(self.embed_document(text) for text in texts)

    def embed_query(self, text: str) -> tuple[float, float]:
        self.queries.append(text)
        return (1.0, 0.0)


class FakeGenerator:
    model = "test-model"

    def generate(self, prompt: str, *, system_instruction: str) -> str:
        return "The source describes alpha [1]."


def _settings() -> EvaluationSettings:
    return EvaluationSettings(
        k=2,
        ranking_unit="globalRemedy",
        fusion_strategy="normalizedScore",
        remedy_name_normalization="nfkcCasefoldWhitespace",
        lexical_query_mode="contentTerms",
        semantic_query_instruction="Find relevant evidence.",
        candidate_pool_size=2,
        quality_metric="recallAtK",
        minimum_quality=0.8,
    )


def test_prepared_index_matches_batch_evaluation_rankings() -> None:
    chunks = tuple(chunk for book in _books() for chunk in chunk_book(book, ChunkingPolicy(1, 1)))
    vectors = ((1.0, 0.0), (0.0, 1.0))
    index = PreparedRetrievalIndex(chunks, vectors, dimensions=2)
    try:
        lexical = index.score_lexical("alpha", limit=2)
        semantic = index.score_semantic((1.0, 0.0), limit=2)
    finally:
        index.close()

    expected_lexical = score_lexical_queries(chunks, ("alpha",), limit=2)[0]
    expected_semantic = score_semantic_queries(
        tuple(chunk.id for chunk in chunks), vectors, ((1.0, 0.0),), dimensions=2, limit=2
    )[0]
    assert lexical == expected_lexical
    assert semantic == expected_semantic


def test_eval_chat_uses_experimental_ranking_and_concrete_citations() -> None:
    books = _books()
    chunks = tuple(chunk for book in books for chunk in chunk_book(book, ChunkingPolicy(1, 1)))
    index = PreparedRetrievalIndex(chunks, ((1.0, 0.0), (0.0, 1.0)), dimensions=2)
    embedder = FakeEmbedder()
    try:
        retriever = ExperimentalRetriever(
            books=books,
            chunks=chunks,
            index=index,
            embedder=embedder,
            settings=_settings(),
            corpus_version="eval-test",
            model_input_limit=2048,
        )
        sources = retriever.retrieve(ChatRequest(message="alpha"), limit=2)
        beta_sources = retriever.retrieve(
            ChatRequest(message="alpha", book_ids=("beta",)), limit=2
        )
    finally:
        index.close()

    assert embedder.queries == [
        "Instruct: Find relevant evidence.\nQuery:alpha",
        "Instruct: Find relevant evidence.\nQuery:alpha",
    ]
    assert sources[0].book_id == "alpha"
    assert sources[0].text == "alpha evidence"
    assert sources[0].chunk_id == chunks[0].id
    assert beta_sources[0].book_id == "beta"


def test_eval_chat_runtime_uses_selected_dimension_and_cached_documents(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import eval_chat.chat_runtime as runtime

    evaluation = load_evaluation_config(ROOT / "evaluation.toml")
    evaluation = replace(
        evaluation,
        dimensions=(2,),
        retrieval=_settings(),
        cache_directory=tmp_path,
        chunking=ChunkingPolicy(1, 1),
    )
    embedder = FakeEmbedder()
    monkeypatch.setattr(runtime, "load_evaluation_config", lambda _path: evaluation)
    monkeypatch.setattr(runtime, "load_corpus_books", lambda _path, _definitions: _books())
    monkeypatch.setattr(runtime, "OpenRouterEmbeddingProvider", lambda _spec: embedder)
    monkeypatch.setattr(runtime, "ZaiChatClient", lambda **_kwargs: FakeGenerator())
    config = EvalChatConfig(ROOT / "evaluation.toml", 2, "test-model", 128)

    service = build_service(config)
    response = service.chat(ChatRequest(message="alpha"))

    assert response.model == "test-model"
    assert response.sources[0].book_id == "alpha"
    assert response.sources[0].id.startswith("eval-")
    assert tuple(tmp_path.glob("documents-2-*.f32"))
    assert tuple(tmp_path.glob("interactive-*.sqlite"))
    assert embedder.document_calls == 2

    monkeypatch.setattr(runtime, "read_document_vectors", lambda *_args, **_kwargs: iter(()))
    second = build_service(config)
    assert second.chat(ChatRequest(message="alpha")).sources[0].book_id == "alpha"
    assert embedder.document_calls == 2


def test_eval_chat_cli_uses_the_shared_conversation_loop(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import eval_chat.chat_cli as cli

    class StubService:
        corpus_version = "eval-test"
        model_name = "test-model"
        books = ()

        def __init__(self) -> None:
            self.requests: list[ChatRequest] = []

        def chat(self, request: ChatRequest) -> ChatResponse:
            self.requests.append(request)
            return ChatResponse(
                answer="Experimental answer.",
                corpus_version=self.corpus_version,
                model=self.model_name,
                sources=(),
            )

    service = StubService()
    monkeypatch.setattr(cli, "load_chat_config", lambda _path: object())
    monkeypatch.setattr(cli, "build_service", lambda _config, **_kwargs: service)
    monkeypatch.setattr(sys, "stdin", io.StringIO("First?\nSecond?\n/clear\nThird?\n/quit\n"))

    assert main([]) == 0
    assert service.requests[0].history == ()
    assert len(service.requests[1].history) == 2
    assert service.requests[2].history == ()
    assert "Experimental answer." in capsys.readouterr().out


def test_eval_chat_config_points_to_evaluation_settings() -> None:
    config = load_chat_config(ROOT / "eval-chat.toml")

    assert config.evaluation_config == ROOT / "evaluation.toml"
    assert config.dimensions == 4096
