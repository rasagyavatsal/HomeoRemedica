from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from homeoremedica_corpus.artifacts import ArtifactSpec


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


class Compatibility(Contract):
    embedding_model: str
    embedding_dimensions: int = Field(gt=0, le=4096)
    document_task_type: str
    query_task_type: str
    embedding_normalization: str
    distance_function: str
    model_input_limit: int = Field(gt=0)
    sqlite_version: str
    sqlite_vec_version: str


class EvaluationGate(Contract):
    dataset_version: str
    dataset_sha256: str
    corpus_hash: str
    result_sha256: str
    metric: str
    threshold: float = Field(ge=0)
    value: float = Field(ge=0)
    chosen_dimensions: int = Field(gt=0, le=4096)

    @model_validator(mode="after")
    def validate_gate(self) -> EvaluationGate:
        _validate_digest(self.dataset_sha256, "evaluation dataset_sha256")
        _validate_digest(self.corpus_hash, "evaluation corpus_hash")
        if not re.fullmatch(r"[0-9a-f]{64}", self.result_sha256):
            raise ValueError("evaluation result_sha256 must be a lowercase SHA-256 digest")
        if self.value < self.threshold:
            raise ValueError("evaluation quality result does not meet its threshold")
        return self


class BuildBook(Contract):
    book_id: str
    title: str
    author: str | None
    filename: str
    byte_size: int = Field(gt=0)
    sha256: str
    source_sha256: str
    chunk_count: int = Field(gt=0)
    passage_count: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_identity(self) -> BuildBook:
        if self.filename != f"books/{self.book_id}.sqlite":
            raise ValueError("book filename must be derived from its book ID")
        _validate_digest(self.sha256, "book sha256")
        _validate_digest(self.source_sha256, "source sha256")
        return self


class BuildDescriptor(Contract):
    manifest_schema_version: int = Field(gt=0)
    artifact_schema_version: int = Field(gt=0)
    corpus_version: str
    corpus_hash: str
    compatibility: Compatibility
    evaluation: EvaluationGate | None
    books: tuple[BuildBook, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_release(self) -> BuildDescriptor:
        _validate_digest(self.corpus_hash, "corpus hash")
        _validate_unique_books(self.books)
        return self


class PublishedBook(Contract):
    book_id: str
    title: str
    author: str | None
    object: str
    generation: int = Field(gt=0)
    byte_size: int = Field(gt=0)
    sha256: str
    source_sha256: str
    chunk_count: int = Field(gt=0)
    passage_count: int = Field(gt=0)

    @model_validator(mode="after")
    def validate_digests(self) -> PublishedBook:
        _validate_digest(self.sha256, "book sha256")
        _validate_digest(self.source_sha256, "source sha256")
        return self


class ReleaseManifest(Contract):
    manifest_schema_version: int = Field(gt=0)
    artifact_schema_version: int = Field(gt=0)
    corpus_version: str
    corpus_hash: str
    compatibility: Compatibility
    evaluation: EvaluationGate
    books: tuple[PublishedBook, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_release(self) -> ReleaseManifest:
        _validate_digest(self.corpus_hash, "corpus hash")
        _validate_unique_books(self.books)
        return self


class ActivePointer(Contract):
    pointer_schema_version: int = 1
    corpus_version: str
    manifest_object: str
    manifest_generation: int = Field(gt=0)
    manifest_byte_size: int = Field(gt=0)
    manifest_sha256: str

    @model_validator(mode="after")
    def validate_digest(self) -> ActivePointer:
        _validate_digest(self.manifest_sha256, "manifest sha256")
        return self


def compatibility_from_artifact_spec(spec: ArtifactSpec) -> Compatibility:
    embedding = spec.embedding
    return Compatibility(
        embedding_model=embedding.model,
        embedding_dimensions=embedding.dimensions,
        document_task_type=embedding.document_task_type,
        query_task_type=embedding.query_task_type,
        embedding_normalization=embedding.normalization,
        distance_function=embedding.distance_function,
        model_input_limit=embedding.model_input_limit,
        sqlite_version=spec.sqlite_version,
        sqlite_vec_version=spec.sqlite_vec_version,
    )


def canonical_json_bytes(model: BaseModel | dict[str, Any]) -> bytes:
    value = model.model_dump(mode="json", by_alias=True) if isinstance(model, BaseModel) else model
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("utf-8")


def _validate_digest(value: str, name: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(f"{name} must be a lowercase SHA-256 digest")


def _validate_unique_books(books: tuple[BuildBook, ...] | tuple[PublishedBook, ...]) -> None:
    book_ids = [book.book_id for book in books]
    if len(set(book_ids)) != len(book_ids):
        raise ValueError("release contains duplicate book IDs")
