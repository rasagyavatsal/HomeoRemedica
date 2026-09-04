from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from homeoremedica_corpus.artifacts import ArtifactSpec, sha256_file, validate_book_artifact
from homeoremedica_corpus.contracts import (
    ActivePointer,
    BuildDescriptor,
    Compatibility,
    PublishedBook,
    ReleaseManifest,
    canonical_json_bytes,
)
from homeoremedica_corpus.embeddings import EmbeddingSpec
from homeoremedica_corpus.storage import ObjectRef, ObjectStore


class PublicationError(RuntimeError):
    """Raised when a release cannot be proven complete and compatible."""


@dataclass(frozen=True, slots=True)
class PublishedRelease:
    manifest: ObjectRef
    pointer: ObjectRef
    active: ActivePointer


class CorpusPublisher:
    """Stage immutable artifacts and atomically activate only verified manifests."""

    def __init__(
        self,
        store: ObjectStore,
        *,
        expected_book_ids: frozenset[str],
        expected_compatibility: Compatibility,
        expected_artifact_schema_version: int,
        expected_manifest_schema_version: int = 1,
        prefix: str = "corpora",
    ) -> None:
        self._store = store
        self._expected_book_ids = expected_book_ids
        self._expected_compatibility = expected_compatibility
        self._expected_artifact_schema_version = expected_artifact_schema_version
        self._expected_manifest_schema_version = expected_manifest_schema_version
        self._prefix = prefix.strip("/")
        self._pointer_name = f"{self._prefix}/active.json"

    def publish(self, release_directory: Path) -> PublishedRelease:
        active = self._store.snapshot(self._pointer_name)
        expected_generation = 0 if active is None else active.generation
        manifest = self.stage_release(release_directory)
        active_contract, pointer = self._activate(manifest, expected_generation)
        return PublishedRelease(manifest=manifest, pointer=pointer, active=active_contract)

    def stage_release(self, release_directory: Path) -> ObjectRef:
        descriptor = self._load_build_descriptor(release_directory)
        self._validate_contract(
            descriptor.manifest_schema_version,
            descriptor.artifact_schema_version,
            descriptor.compatibility,
            descriptor.evaluation.chosen_dimensions if descriptor.evaluation else None,
            {book.book_id for book in descriptor.books},
        )
        if descriptor.evaluation is None:
            raise PublicationError("release has no versioned retrieval evaluation result")
        if descriptor.evaluation.corpus_hash != descriptor.corpus_hash:
            raise PublicationError("release uses a retrieval evaluation from a different corpus")

        spec = _artifact_spec(descriptor)
        local_artifacts = []
        for book in descriptor.books:
            path = release_directory / book.filename
            if not path.is_file():
                raise PublicationError(f"release is incomplete: missing {book.filename}")
            if path.stat().st_size != book.byte_size or sha256_file(path) != book.sha256:
                raise PublicationError(
                    f"local artifact digest verification failed: {book.filename}"
                )
            validated = validate_book_artifact(path, spec)
            if (
                validated.book_id != book.book_id
                or validated.title != book.title
                or validated.author != book.author
                or validated.source_sha256 != book.source_sha256
                or validated.chunk_count != book.chunk_count
                or validated.passage_count != book.passage_count
            ):
                raise PublicationError(f"local artifact metadata mismatch: {book.filename}")
            local_artifacts.append((book, path))

        published_books = []
        for book, path in local_artifacts:
            object_name = f"{self._prefix}/{descriptor.corpus_version}/books/{book.book_id}.sqlite"
            reference = self._store.create_file(object_name, path)
            self._store.verify(reference, byte_size=book.byte_size, sha256=book.sha256)
            published_books.append(
                PublishedBook(
                    book_id=book.book_id,
                    title=book.title,
                    author=book.author,
                    object=reference.name,
                    generation=reference.generation,
                    byte_size=book.byte_size,
                    sha256=book.sha256,
                    source_sha256=book.source_sha256,
                    chunk_count=book.chunk_count,
                    passage_count=book.passage_count,
                )
            )

        manifest = ReleaseManifest(
            manifest_schema_version=descriptor.manifest_schema_version,
            artifact_schema_version=descriptor.artifact_schema_version,
            corpus_version=descriptor.corpus_version,
            corpus_hash=descriptor.corpus_hash,
            compatibility=descriptor.compatibility,
            evaluation=descriptor.evaluation,
            books=tuple(published_books),
        )
        manifest_bytes = canonical_json_bytes(manifest)
        manifest_name = f"{self._prefix}/{descriptor.corpus_version}/manifest.json"
        reference = self._store.create_bytes(manifest_name, manifest_bytes)
        self._store.verify(
            reference,
            byte_size=len(manifest_bytes),
            sha256=reference.sha256,
        )
        self.verify_manifest(reference)
        return reference

    def activate(self, manifest: ObjectRef, *, expected_active_generation: int) -> ActivePointer:
        active, _ = self._activate(manifest, expected_active_generation)
        return active

    def rollback(self, corpus_version: str) -> ActivePointer:
        current = self._store.snapshot(self._pointer_name)
        expected_generation = 0 if current is None else current.generation
        manifest_name = f"{self._prefix}/{corpus_version}/manifest.json"
        manifest = self._store.snapshot(manifest_name)
        if manifest is None:
            raise PublicationError(f"rollback manifest does not exist: {manifest_name}")
        active, _ = self._activate(manifest, expected_generation)
        return active

    def verify_manifest(self, reference: ObjectRef) -> ReleaseManifest:
        self._store.verify(
            reference,
            byte_size=reference.byte_size,
            sha256=reference.sha256,
        )
        try:
            manifest = ReleaseManifest.model_validate_json(
                self._store.read_bytes(reference.name, reference.generation)
            )
        except (ValidationError, ValueError, json.JSONDecodeError) as error:
            raise PublicationError(
                f"invalid release manifest: {reference.name}: {error}"
            ) from error
        self._validate_contract(
            manifest.manifest_schema_version,
            manifest.artifact_schema_version,
            manifest.compatibility,
            manifest.evaluation.chosen_dimensions,
            {book.book_id for book in manifest.books},
        )
        expected_name = f"{self._prefix}/{manifest.corpus_version}/manifest.json"
        if reference.name != expected_name:
            raise PublicationError(
                "manifest object does not match corpus version: "
                f"{reference.name} != {expected_name}"
            )
        for book in manifest.books:
            artifact = ObjectRef(
                name=book.object,
                generation=book.generation,
                byte_size=book.byte_size,
                sha256=book.sha256,
            )
            self._store.verify(artifact, byte_size=book.byte_size, sha256=book.sha256)
        return manifest

    def _activate(
        self, manifest_reference: ObjectRef, expected_generation: int
    ) -> tuple[ActivePointer, ObjectRef]:
        manifest = self.verify_manifest(manifest_reference)
        active = ActivePointer(
            corpus_version=manifest.corpus_version,
            manifest_object=manifest_reference.name,
            manifest_generation=manifest_reference.generation,
            manifest_byte_size=manifest_reference.byte_size,
            manifest_sha256=manifest_reference.sha256,
        )
        pointer = self._store.replace_bytes(
            self._pointer_name,
            canonical_json_bytes(active),
            if_generation_match=expected_generation,
        )
        return active, pointer

    def _load_build_descriptor(self, release_directory: Path) -> BuildDescriptor:
        descriptor_path = release_directory / "build.json"
        try:
            return BuildDescriptor.model_validate_json(descriptor_path.read_bytes())
        except (OSError, ValidationError, ValueError, json.JSONDecodeError) as error:
            raise PublicationError(f"invalid local release descriptor: {error}") from error

    def _validate_contract(
        self,
        manifest_schema_version: int,
        artifact_schema_version: int,
        compatibility: Compatibility,
        chosen_dimensions: int | None,
        book_ids: set[str],
    ) -> None:
        if (
            manifest_schema_version != self._expected_manifest_schema_version
            or artifact_schema_version != self._expected_artifact_schema_version
            or compatibility != self._expected_compatibility
            or chosen_dimensions != compatibility.embedding_dimensions
            or book_ids != self._expected_book_ids
        ):
            raise PublicationError(
                "release is incomplete or incompatible "
                f"(books={sorted(book_ids)}, expected_books={sorted(self._expected_book_ids)})"
            )


def _artifact_spec(descriptor: BuildDescriptor) -> ArtifactSpec:
    compatibility = descriptor.compatibility
    return ArtifactSpec(
        corpus_version=descriptor.corpus_version,
        corpus_hash=descriptor.corpus_hash,
        artifact_schema_version=descriptor.artifact_schema_version,
        embedding=EmbeddingSpec(
            model=compatibility.embedding_model,
            dimensions=compatibility.embedding_dimensions,
            document_task_type=compatibility.document_task_type,
            query_task_type=compatibility.query_task_type,
            normalization=compatibility.embedding_normalization,
            distance_function=compatibility.distance_function,
            model_input_limit=compatibility.model_input_limit,
        ),
        sqlite_version=compatibility.sqlite_version,
        sqlite_vec_version=compatibility.sqlite_vec_version,
    )
