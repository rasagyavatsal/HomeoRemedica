from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from corpus.artifacts import ArtifactSpec

_SAFE_PATH_COMPONENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


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
    embedding_model: str = Field(min_length=1, max_length=128)
    embedding_dimensions: int = Field(gt=0, le=4096)
    document_task_type: str = Field(min_length=1, max_length=128)
    query_task_type: str = Field(min_length=1, max_length=128)
    embedding_normalization: str = Field(min_length=1, max_length=32)
    distance_function: str = Field(min_length=1, max_length=32)
    model_input_limit: int = Field(gt=0, le=100_000)
    sqlite_version: str = Field(min_length=1, max_length=32)
    sqlite_vec_version: str = Field(min_length=1, max_length=32)


class PublishedBook(Contract):
    """The local file and source metadata for one release book."""

    book_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=512)
    author: str | None = Field(default=None, max_length=256)
    filename: str = Field(min_length=1, max_length=256)
    byte_size: int = Field(gt=0, le=4 * 1024 * 1024 * 1024)
    sha256: str
    source_sha256: str
    chunk_count: int = Field(gt=0, le=1_000_000)
    passage_count: int = Field(gt=0, le=1_000_000)

    @model_validator(mode="after")
    def validate_identity(self) -> PublishedBook:
        _require_safe_path_component(self.book_id, "book ID")
        if self.filename != f"books/{self.book_id}.sqlite":
            raise ValueError("book filename must be derived from its book ID")
        _validate_digest(self.sha256, "book sha256")
        _validate_digest(self.source_sha256, "source sha256")
        return self


class ReleaseManifest(Contract):
    """The immutable compatibility and file inventory for one local release."""

    manifest_schema_version: int = Field(gt=0)
    artifact_schema_version: int = Field(gt=0)
    corpus_version: str = Field(min_length=1, max_length=128)
    corpus_hash: str
    compatibility: Compatibility
    books: tuple[PublishedBook, ...] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def validate_release(self) -> ReleaseManifest:
        _require_safe_path_component(self.corpus_version, "corpus version")
        if self.manifest_schema_version not in {1, 2}:
            raise ValueError("unsupported manifest schema version")
        if self.artifact_schema_version != 1:
            raise ValueError("unsupported artifact schema version")
        _validate_digest(self.corpus_hash, "corpus hash")
        book_ids = [book.book_id for book in self.books]
        if len(set(book_ids)) != len(book_ids):
            raise ValueError("release contains duplicate book IDs")
        return self


class ActivePointer(Contract):
    """The small atomically replaced pointer at the corpus root."""

    pointer_schema_version: int = 1
    corpus_version: str = Field(min_length=1, max_length=128)
    manifest_path: str = Field(min_length=1, max_length=256)
    manifest_byte_size: int = Field(gt=0, le=1 * 1024 * 1024)
    manifest_sha256: str

    @model_validator(mode="after")
    def validate_pointer(self) -> ActivePointer:
        _require_safe_path_component(self.corpus_version, "corpus version")
        if self.pointer_schema_version != 1:
            raise ValueError("unsupported active pointer schema version")
        if self.manifest_path != f"{self.corpus_version}/manifest.json":
            raise ValueError("manifest path must point inside the active release")
        _validate_digest(self.manifest_sha256, "manifest sha256")
        return self


# The builder used this name before releases became local. Keep the alias for
# callers that only need the release-book schema.
BuildBook = PublishedBook


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


def _require_safe_path_component(value: str, label: str) -> None:
    if not _SAFE_PATH_COMPONENT.fullmatch(value):
        raise ValueError(f"{label} must be a safe path component")


def _validate_digest(value: str, name: str) -> None:
    if not _SHA256.fullmatch(value):
        raise ValueError(f"{name} must be a lowercase SHA-256 digest")
