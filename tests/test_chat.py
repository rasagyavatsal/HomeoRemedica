from __future__ import annotations

from typing import Any

import pytest

from homeoremedica_chat.chat import (
    ChatRequest,
    ChatService,
    ChatTurn,
    RetrievedSource,
)


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


class StubVertexModel:
    model = "gemini-2.5-flash-lite"

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
    model = StubVertexModel()
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
    assert response.model == "gemini-2.5-flash-lite"
    assert response.sources[0].id == "2026-08-15.v1/kent-lectures/chk_1"


def test_chat_request_rejects_an_oversized_history_budget() -> None:
    from pydantic import ValidationError

    history = (ChatTurn(role="user", content="x" * 4_000),) * 5
    with pytest.raises(ValidationError, match="history must not exceed"):
        ChatRequest(message="current question", history=history)


def test_chat_request_bounds_book_identifiers() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="invalid identifier"):
        ChatRequest(message="question", book_ids=("x" * 65,))
