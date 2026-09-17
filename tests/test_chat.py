from __future__ import annotations

from typing import Any

import pytest

from chat.retrieval import ProductionRetriever
from shared.contracts import ChatRequest, ChatTurn, RetrievedSource
from shared.errors import ChatFailure, TokenExhaustionError
from shared.service import ChatService


class StubRetriever:
    corpus_version = "2026-08-15.v1"
    model_input_limit = 8_192
    books = ()

    def __init__(self) -> None:
        self.search_call: dict[str, Any] | None = None
        self.failure: Exception | None = None

    def retrieve(self, request: ChatRequest, *, limit: int) -> tuple[RetrievedSource, ...]:
        self.search_call = {"request": request, "limit": limit}
        if self.failure:
            raise self.failure
        return (
            RetrievedSource(
                chunk_id="chk_1",
                book_id="kent-lectures",
                book_title="Kent's Lectures",
                author="James Tyler Kent",
                remedy_name="NUX VOMICA",
                section_title="MIND",
                passage_indexes=(3, 4),
                text="The patient is irritable and oversensitive.",
                score=0.03,
            ),
        )


class StubGenerator:
    model = "glm-5.3-flash"

    def __init__(self) -> None:
        self.generation_prompt: str | None = None
        self.failure: Exception | None = None

    def generate(self, prompt: str, *, system_instruction: str) -> str:
        self.generation_prompt = prompt
        assert "medical advice" in system_instruction
        if self.failure:
            raise self.failure
        return "Kent describes irritability and oversensitivity [1]."


def test_chat_grounds_a_conversation_aware_answer_in_versioned_sources() -> None:
    retriever = StubRetriever()
    generator = StubGenerator()
    service = ChatService(retriever=retriever, generator=generator)
    request = ChatRequest(
        message="What about irritability?",
        history=(ChatTurn(role="user", content="Tell me about Nux vomica."),),
        book_ids=("kent-lectures",),
    )

    response = service.chat(request)

    assert retriever.search_call == {"request": request, "limit": 8}
    assert generator.generation_prompt is not None
    assert "[1] Kent's Lectures — NUX VOMICA — MIND" in generator.generation_prompt
    assert "untrusted user-provided context" in generator.generation_prompt
    assert "untrusted reference data" in generator.generation_prompt
    assert response.answer == (
        "Historical materia medica reference only—not medical advice. "
        "For health decisions, consult a qualified clinician.\n\n"
        "Kent describes irritability and oversensitivity [1]."
    )
    assert response.corpus_version == "2026-08-15.v1"
    assert response.model == "glm-5.3-flash"
    assert response.sources[0].id == "2026-08-15.v1/kent-lectures/chk_1"


def test_chat_classifies_retrieval_errors_without_exposing_details() -> None:
    retriever = StubRetriever()
    retriever.failure = RuntimeError("database secret")

    with pytest.raises(ChatFailure) as error:
        ChatService(retriever=retriever, generator=StubGenerator()).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "corpus_search"
    assert error.value.kind == "internal"
    assert "database secret" not in str(error.value)


def test_chat_preserves_embedding_failure_stage() -> None:
    retriever = StubRetriever()
    retriever.failure = ChatFailure(stage="embedding", kind="timeout", error_type="TimeoutError")

    with pytest.raises(ChatFailure) as error:
        ChatService(retriever=retriever, generator=StubGenerator()).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "embedding"
    assert error.value.kind == "timeout"


def test_chat_classifies_answer_provider_errors() -> None:
    generator = StubGenerator()
    generator.failure = RuntimeError("provider secret")

    with pytest.raises(ChatFailure) as error:
        ChatService(retriever=StubRetriever(), generator=generator).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "answer_generation"
    assert error.value.kind == "provider"
    assert error.value.error_type == "RuntimeError"
    assert "provider secret" not in str(error.value)


def test_chat_classifies_token_exhaustion_without_returning_partial_content() -> None:
    generator = StubGenerator()
    generator.failure = TokenExhaustionError()

    with pytest.raises(ChatFailure) as error:
        ChatService(retriever=StubRetriever(), generator=generator).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "answer_generation"
    assert error.value.kind == "token_exhaustion"


def test_chat_request_rejects_an_oversized_history_budget() -> None:
    from pydantic import ValidationError

    history = (ChatTurn(role="user", content="x" * 4_000),) * 5
    with pytest.raises(ValidationError, match="history must not exceed"):
        ChatRequest(message="current question", history=history)


def test_chat_request_bounds_book_identifiers() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="invalid identifier"):
        ChatRequest(message="question", book_ids=("x" * 65,))


def test_production_retriever_embeds_conversation_and_filters_books() -> None:
    class Corpus:
        corpus_version = "local-v1"
        model_input_limit = 8192
        books = ()

        def __init__(self) -> None:
            self.search_call: tuple[object, ...] | None = None

        def search(
            self,
            query: str,
            embedding: tuple[float, ...],
            *,
            book_ids: tuple[str, ...] | None,
            limit: int,
        ) -> tuple[RetrievedSource, ...]:
            self.search_call = (query, embedding, book_ids, limit)
            return ()

    class Embedder:
        def __init__(self) -> None:
            self.query: str | None = None

        def embed_query(self, text: str) -> tuple[float, ...]:
            self.query = text
            return (1.0, 0.0)

    corpus = Corpus()
    embedder = Embedder()
    retriever = ProductionRetriever(corpus, embedder)
    retriever.retrieve(
        ChatRequest(
            message="What about irritability?",
            history=(ChatTurn(role="user", content="Tell me about Nux vomica."),),
            book_ids=("kent-lectures",),
        ),
        limit=8,
    )

    query = "Tell me about Nux vomica.\nWhat about irritability?"
    assert embedder.query == query
    assert corpus.search_call == (query, (1.0, 0.0), ("kent-lectures",), 8)


def test_production_retriever_classifies_embedding_timeout() -> None:
    class Corpus:
        corpus_version = "local-v1"
        model_input_limit = 8192
        books = ()

    class Embedder:
        def embed_query(self, text: str) -> tuple[float, ...]:
            raise TimeoutError("embedding secret")

    retriever = ProductionRetriever(Corpus(), Embedder())
    with pytest.raises(ChatFailure) as error:
        retriever.retrieve(ChatRequest(message="question"), limit=8)

    assert error.value.stage == "embedding"
    assert error.value.kind == "timeout"
    assert "embedding secret" not in str(error.value)
