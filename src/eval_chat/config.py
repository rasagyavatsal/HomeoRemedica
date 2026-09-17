from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

from corpus.chunking import ChunkingPolicy
from corpus.sources import BookDefinition
from eval_chat.embeddings import (
    QWEN3_EMBEDDING_MODEL,
    QWEN3_NATIVE_DIMENSIONS,
    EmbeddingSpec,
)
from eval_chat.evaluation import EvaluationSettings
from eval_chat.paths import benchmark_cache_directory, benchmark_query_path, benchmark_result_path


class _Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class _SourceSettings(_Settings):
    corpus_dataset: str


class _ChunkingSettings(_Settings):
    minimum_tokens: int = Field(gt=0)
    target_tokens: int = Field(gt=0)


class _EmbeddingSettings(_Settings):
    model: str
    native_dimensions: int = Field(gt=0, le=4096)
    dimensions: tuple[int, ...]
    model_input_limit: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_embedding_contract(self) -> _EmbeddingSettings:
        if self.model != QWEN3_EMBEDDING_MODEL:
            raise ValueError(f"evaluation embedding model must be {QWEN3_EMBEDDING_MODEL}")
        if self.native_dimensions != QWEN3_NATIVE_DIMENSIONS:
            raise ValueError(
                f"{QWEN3_EMBEDDING_MODEL} returns {QWEN3_NATIVE_DIMENSIONS} native dimensions"
            )
        if (
            not self.dimensions
            or len(set(self.dimensions)) != len(self.dimensions)
            or tuple(sorted(self.dimensions)) != self.dimensions
            or any(not 1 <= dimension <= self.native_dimensions for dimension in self.dimensions)
        ):
            raise ValueError(
                "evaluation dimensions must be unique, ascending, and within the native vector"
            )
        return self


class _OutputSettings(_Settings):
    dataset: str
    result: str
    cache_directory: str


class _BookSettings(_Settings):
    title: str = Field(min_length=1)
    author: str | None = None


class _FileSettings(_Settings):
    source: _SourceSettings
    chunking: _ChunkingSettings
    embedding: _EmbeddingSettings
    retrieval: EvaluationSettings
    output: _OutputSettings
    books: dict[str, _BookSettings] = Field(min_length=1)


@dataclass(frozen=True, slots=True)
class EvaluationConfig:
    config_path: Path
    corpus_dataset: Path
    chunking: ChunkingPolicy
    embedding: EmbeddingSpec
    dimensions: tuple[int, ...]
    retrieval: EvaluationSettings
    dataset: Path
    result: Path
    cache_directory: Path
    books: dict[str, BookDefinition]


def load_evaluation_config(path: Path = Path("evaluation.toml")) -> EvaluationConfig:
    resolved_path = path.resolve()
    with resolved_path.open("rb") as source:
        settings = _FileSettings.model_validate(tomllib.load(source))
    root = resolved_path.parent
    books = {
        book_id: BookDefinition(title=book.title, author=book.author)
        for book_id, book in settings.books.items()
    }
    for book_id in books:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", book_id):
            raise ValueError(f"book ID is not filename-safe: {book_id}")
    return EvaluationConfig(
        config_path=resolved_path,
        corpus_dataset=_resolve(root, settings.source.corpus_dataset),
        chunking=ChunkingPolicy(
            target_tokens=settings.chunking.target_tokens,
            minimum_tokens=settings.chunking.minimum_tokens,
        ),
        embedding=EmbeddingSpec(
            model=settings.embedding.model,
            dimensions=settings.embedding.native_dimensions,
            native_dimensions=settings.embedding.native_dimensions,
            model_input_limit=settings.embedding.model_input_limit,
        ),
        dimensions=settings.embedding.dimensions,
        retrieval=settings.retrieval,
        dataset=benchmark_query_path(Path(settings.output.dataset), root),
        result=benchmark_result_path(Path(settings.output.result), root),
        cache_directory=benchmark_cache_directory(Path(settings.output.cache_directory), root),
        books=books,
    )


def _resolve(root: Path, value: str) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (root / path).resolve()
