from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _camel_case(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class Contract(BaseModel):
    model_config = ConfigDict(
        alias_generator=_camel_case,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class ChatTurn(Contract):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4_000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value.strip()


class BookSummary(Contract):
    book_id: str
    title: str
    author: str | None = None


MAX_HISTORY_TURNS = 20
MAX_HISTORY_CHARS = 16_000
MAX_BOOK_ID_CHARS = 64
BOOK_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
MAX_RETRIEVAL_QUERY_CHARS = 8_000
DEFAULT_MODEL_INPUT_LIMIT_TOKENS = 8_192
MAX_CITATION_TEXT_CHARS = 8_000
MAX_GENERATION_PROMPT_CHARS = 64_000
MAX_GENERATED_ANSWER_CHARS = 12_000


class ChatRequest(Contract):
    message: str = Field(min_length=1, max_length=4_000)
    history: tuple[ChatTurn, ...] = Field(default=(), max_length=MAX_HISTORY_TURNS)
    book_ids: tuple[str, ...] | None = Field(default=None, min_length=1, max_length=4)

    @model_validator(mode="after")
    def history_must_fit_budget(self) -> ChatRequest:
        if sum(len(turn.content) for turn in self.history) > MAX_HISTORY_CHARS:
            raise ValueError(f"history must not exceed {MAX_HISTORY_CHARS} characters")
        return self

    @field_validator("message")
    @classmethod
    def message_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message must not be blank")
        return value.strip()

    @field_validator("book_ids")
    @classmethod
    def book_ids_must_be_safe(cls, value: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if value is None:
            return value
        if any(not BOOK_ID_PATTERN.fullmatch(book_id) for book_id in value):
            raise ValueError("bookIds contain an invalid identifier")
        if len(set(value)) != len(value):
            raise ValueError("bookIds must not contain duplicates")
        return value


@dataclass(frozen=True, slots=True)
class RetrievedSource:
    chunk_id: str
    book_id: str
    book_title: str
    author: str | None
    remedy_name: str
    section_title: str
    passage_indexes: tuple[int, ...]
    text: str
    score: float


class Citation(Contract):
    id: str
    book_id: str
    book_title: str
    author: str | None
    remedy_name: str
    section_title: str
    passage_indexes: tuple[int, ...]
    text: str = Field(max_length=MAX_CITATION_TEXT_CHARS)


class ChatResponse(Contract):
    answer: str
    corpus_version: str
    model: str
    sources: tuple[Citation, ...]


class Retriever(Protocol):
    corpus_version: str

    @property
    def books(self) -> tuple[BookSummary, ...]: ...

    @property
    def model_input_limit(self) -> int: ...

    def retrieve(self, request: ChatRequest, *, limit: int) -> tuple[RetrievedSource, ...]: ...


class AnswerGenerator(Protocol):
    model: str

    def generate(self, prompt: str, *, system_instruction: str) -> str: ...
