from __future__ import annotations

from typing import Any

import pytest

from chat.chat import (
    ChatRequest,
    ChatService,
    ChatTurn,
    RetrievedSource,
)
from chat.errors import ChatFailure


class StubCorpus:
    corpus_version = "2026-08-15.v1"
    model_input_limit = 8_192

    def __init__(self) -> None:
        self.search_call: dict[str, Any] | None = None

    def search(
        self,
        query: str,
        embedding: tuple[float, ...],
        *,
        book_ids: tuple[str, ...] | None,
        limit: int,
    ) -> tuple[RetrievedSource, ...]:
        self.search_call = {
            "query": query,
            "embedding": embedding,
            "book_ids": book_ids,
            "limit": limit,
        }
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


class StubChatModel:
    model = "glm-5.3-flash"

    def __init__(self) -> None:
        self.embedding_input: str | None = None
        self.generation_prompt: str | None = None

    def embed_query(self, text: str, *, dimensions: int, task_type: str) -> tuple[float, ...]:
        self.embedding_input = text
        assert dimensions == 1536
        assert task_type == "RETRIEVAL_QUERY"
        return (1.0,) + (0.0,) * 1535

    def generate(self, prompt: str, *, system_instruction: str) -> str:
        self.generation_prompt = prompt
        assert "medical advice" in system_instruction
        return "Kent describes irritability and oversensitivity [1]."


def test_chat_grounds_a_conversation_aware_answer_in_versioned_sources() -> None:
    corpus = StubCorpus()
    model = StubChatModel()
    service = ChatService(corpus=corpus, model=model, embedding_dimensions=1536)

    response = service.chat(
        ChatRequest(
            message="What about irritability?",
            history=(ChatTurn(role="user", content="Tell me about Nux vomica."),),
            book_ids=("kent-lectures",),
        )
    )

    assert model.embedding_input == "Tell me about Nux vomica.\nWhat about irritability?"
    assert corpus.search_call == {
        "query": model.embedding_input,
        "embedding": (1.0,) + (0.0,) * 1535,
        "book_ids": ("kent-lectures",),
        "limit": 8,
    }
    assert model.generation_prompt is not None
    assert "[1] Kent's Lectures — NUX VOMICA — MIND" in model.generation_prompt
    assert "untrusted user-provided context" in model.generation_prompt
    assert "untrusted reference data" in model.generation_prompt
    assert response.answer == (
        "Historical materia medica reference only—not medical advice. "
        "For health decisions, consult a qualified clinician.\n\n"
        "Kent describes irritability and oversensitivity [1]."
    )
    assert response.corpus_version == "2026-08-15.v1"
    assert response.model == "glm-5.3-flash"
    assert response.sources[0].id == "2026-08-15.v1/kent-lectures/chk_1"


def test_chat_classifies_embedding_timeouts_without_exposing_details() -> None:
    corpus = StubCorpus()
    model = StubChatModel()

    def fail_embedding(
        text: str,
        *,
        dimensions: int,
        task_type: str,
    ) -> tuple[float, ...]:
        raise TimeoutError("embedding secret")

    model.embed_query = fail_embedding  # type: ignore[method-assign]

    with pytest.raises(ChatFailure) as error:
        ChatService(corpus=corpus, model=model, embedding_dimensions=1536).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "embedding"
    assert error.value.kind == "timeout"
    assert error.value.error_type == "TimeoutError"
    assert "embedding secret" not in str(error.value)


def test_chat_classifies_corpus_search_errors() -> None:
    corpus = StubCorpus()
    model = StubChatModel()

    def fail_search(
        query: str,
        embedding: tuple[float, ...],
        *,
        book_ids: tuple[str, ...] | None,
        limit: int,
    ) -> tuple[RetrievedSource, ...]:
        raise RuntimeError("database secret")

    corpus.search = fail_search  # type: ignore[method-assign]

    with pytest.raises(ChatFailure) as error:
        ChatService(corpus=corpus, model=model, embedding_dimensions=1536).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "corpus_search"
    assert error.value.kind == "internal"
    assert error.value.error_type == "RuntimeError"
    assert "database secret" not in str(error.value)


def test_chat_classifies_answer_provider_errors() -> None:
    corpus = StubCorpus()
    model = StubChatModel()

    def fail_generation(prompt: str, *, system_instruction: str) -> str:
        raise RuntimeError("provider secret")

    model.generate = fail_generation  # type: ignore[method-assign]

    with pytest.raises(ChatFailure) as error:
        ChatService(corpus=corpus, model=model, embedding_dimensions=1536).chat(
            ChatRequest(message="question")
        )

    assert error.value.stage == "answer_generation"
    assert error.value.kind == "provider"
    assert error.value.error_type == "RuntimeError"
    assert "provider secret" not in str(error.value)


def test_chat_request_rejects_an_oversized_history_budget() -> None:
    from pydantic import ValidationError

    history = (ChatTurn(role="user", content="x" * 4_000),) * 5
    with pytest.raises(ValidationError, match="history must not exceed"):
        ChatRequest(message="current question", history=history)


def test_chat_request_bounds_book_identifiers() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="invalid identifier"):
        ChatRequest(message="question", book_ids=("x" * 65,))
