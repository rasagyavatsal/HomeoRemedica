from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

from homeoremedica_corpus.artifacts import ArtifactSpec
from homeoremedica_corpus.chunking import ChunkingPolicy
from homeoremedica_corpus.embeddings import (
    QWEN3_EMBEDDING_MODEL,
    QWEN3_NATIVE_DIMENSIONS,
    EmbeddingSpec,
)
from homeoremedica_corpus.sources import BookDefinition


class _Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class _CorpusSettings(_Settings):
    combined_dataset: str
    output_directory: str
    artifact_schema_version: int = Field(gt=0)
    manifest_schema_version: int = Field(gt=0)
    sqlite_version: str
    sqlite_vec_version: str

    @model_validator(mode="after")
    def validate_versions(self) -> _CorpusSettings:
        if not re.fullmatch(r"\d+\.\d+\.\d+", self.sqlite_version):
            raise ValueError("sqlite_version must pin an exact semantic version")
        if not re.fullmatch(r"0\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?", self.sqlite_vec_version):
            raise ValueError("sqlite_vec_version must pin an exact pre-1.0 version")
        return self


class _ChunkingSettings(_Settings):
    minimum_tokens: int = Field(gt=0)
    target_tokens: int = Field(gt=0)


class _EmbeddingSettings(_Settings):
    model: str
    native_dimensions: int = Field(gt=0, le=4096)
    dimensions: int = Field(gt=0, le=4096)
    evaluation_dimensions: tuple[int, ...]
    document_task_type: str
    query_task_type: str
    normalization: str
    distance_function: str
    model_input_limit: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_embedding_contract(self) -> _EmbeddingSettings:
        if self.model != QWEN3_EMBEDDING_MODEL:
            raise ValueError(f"embedding model must be {QWEN3_EMBEDDING_MODEL}")
        if self.native_dimensions != QWEN3_NATIVE_DIMENSIONS:
            raise ValueError(
                f"{QWEN3_EMBEDDING_MODEL} returns {QWEN3_NATIVE_DIMENSIONS} native dimensions"
            )
        if self.dimensions > self.native_dimensions:
            raise ValueError("pinned dimensions cannot exceed the model's native dimensions")
        if self.evaluation_dimensions[0] != 768 or not any(
            dimension > 768 for dimension in self.evaluation_dimensions
        ):
            raise ValueError(
                "evaluation must start at 768 and compare at least one higher dimension"
            )
        if (
            len(set(self.evaluation_dimensions)) != len(self.evaluation_dimensions)
            or tuple(sorted(self.evaluation_dimensions)) != self.evaluation_dimensions
            or any(
                not 1 <= dimension <= self.native_dimensions
                for dimension in self.evaluation_dimensions
            )
        ):
            raise ValueError(
                "evaluation_dimensions must be unique, ascending, and at most "
                f"{self.native_dimensions}"
            )
        if self.dimensions not in self.evaluation_dimensions:
            raise ValueError("pinned dimensions must be included in evaluation_dimensions")
        return self


class _EvaluationSettings(_Settings):
    dataset: str
    result: str


class _BookSettings(_Settings):
    title: str = Field(min_length=1)
    author: str | None = None


class _FileSettings(_Settings):
    corpus: _CorpusSettings
    chunking: _ChunkingSettings
    embedding: _EmbeddingSettings
    evaluation: _EvaluationSettings
    books: dict[str, _BookSettings] = Field(min_length=1)


@dataclass(frozen=True, slots=True)
class PipelineConfig:
    config_path: Path
    combined_dataset: Path
    output_directory: Path
    artifact_schema_version: int
    manifest_schema_version: int
    sqlite_version: str
    sqlite_vec_version: str
    chunking: ChunkingPolicy
    embedding: EmbeddingSpec
    evaluation_dimensions: tuple[int, ...]
    evaluation_dataset: Path
    evaluation_result: Path
    books: dict[str, BookDefinition]

    def artifact_spec(self, corpus_version: str, corpus_hash: str | None = None) -> ArtifactSpec:
        return ArtifactSpec(
            corpus_version=corpus_version,
            corpus_hash=corpus_hash,
            embedding=self.embedding,
            sqlite_version=self.sqlite_version,
            sqlite_vec_version=self.sqlite_vec_version,
            artifact_schema_version=self.artifact_schema_version,
        )


def load_pipeline_config(path: Path = Path("corpus.toml")) -> PipelineConfig:
    resolved_path = path.resolve()
    with resolved_path.open("rb") as source:
        settings = _FileSettings.model_validate(tomllib.load(source))
    root = resolved_path.parent
    chunking = ChunkingPolicy(
        target_tokens=settings.chunking.target_tokens,
        minimum_tokens=settings.chunking.minimum_tokens,
    )
    embedding = EmbeddingSpec(
        model=settings.embedding.model,
        dimensions=settings.embedding.dimensions,
        native_dimensions=settings.embedding.native_dimensions,
        document_task_type=settings.embedding.document_task_type,
        query_task_type=settings.embedding.query_task_type,
        normalization=settings.embedding.normalization,
        distance_function=settings.embedding.distance_function,
        model_input_limit=settings.embedding.model_input_limit,
    )
    books = {
        book_id: BookDefinition(title=book.title, author=book.author)
        for book_id, book in settings.books.items()
    }
    for book_id in books:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", book_id):
            raise ValueError(f"book ID is not filename-safe: {book_id}")
    return PipelineConfig(
        config_path=resolved_path,
        combined_dataset=_resolve(root, settings.corpus.combined_dataset),
        output_directory=_resolve(root, settings.corpus.output_directory),
        artifact_schema_version=settings.corpus.artifact_schema_version,
        manifest_schema_version=settings.corpus.manifest_schema_version,
        sqlite_version=settings.corpus.sqlite_version,
        sqlite_vec_version=settings.corpus.sqlite_vec_version,
        chunking=chunking,
        embedding=embedding,
        evaluation_dimensions=settings.embedding.evaluation_dimensions,
        evaluation_dataset=_resolve(root, settings.evaluation.dataset),
        evaluation_result=_resolve(root, settings.evaluation.result),
        books=books,
    )


def _resolve(root: Path, value: str) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (root / path).resolve()
