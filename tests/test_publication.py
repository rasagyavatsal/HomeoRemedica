from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest

from homeoremedica_corpus.artifacts import ArtifactSpec
from homeoremedica_corpus.builder import BuiltRelease, build_release
from homeoremedica_corpus.chunking import chunk_book, corpus_hash
from homeoremedica_corpus.contracts import EvaluationGate, compatibility_from_artifact_spec
from homeoremedica_corpus.embeddings import EmbeddingSpec
from homeoremedica_corpus.publication import CorpusPublisher, PublicationError
from homeoremedica_corpus.sources import Book, Remedy, Section
from homeoremedica_corpus.storage import ObjectRef, PublicationConflict


@dataclass
class FakeProvider:
    dimensions: int = 2

    def count_tokens(self, text: str) -> int:
        return 1

    def embed_document(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0)

    def embed_query(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0)


@dataclass
class StoredVersion:
    generation: int
    contents: bytes


class MemoryObjectStore:
    def __init__(self) -> None:
        self.objects: dict[str, list[StoredVersion]] = {}
        self.next_generation = 1
        self.fail_create_name: str | None = None

    def snapshot(self, name: str) -> ObjectRef | None:
        versions = self.objects.get(name)
        if not versions:
            return None
        current = versions[-1]
        return self._ref(name, current)

    def create_file(self, name: str, path: Path) -> ObjectRef:
        return self.create_bytes(name, path.read_bytes())

    def create_bytes(self, name: str, contents: bytes) -> ObjectRef:
        if name == self.fail_create_name:
            raise RuntimeError("injected upload failure")
        if self.snapshot(name) is not None:
            raise PublicationConflict(f"object already exists: {name}")
        return self._append(name, contents)

    def replace_bytes(self, name: str, contents: bytes, *, if_generation_match: int) -> ObjectRef:
        current = self.snapshot(name)
        actual = 0 if current is None else current.generation
        if actual != if_generation_match:
            raise PublicationConflict(
                f"generation precondition failed for {name}: "
                f"expected {if_generation_match}, got {actual}"
            )
        return self._append(name, contents)

    def read_bytes(self, name: str, generation: int) -> bytes:
        for version in self.objects.get(name, []):
            if version.generation == generation:
                return version.contents
        raise PublicationError(f"object generation not found: {name}#{generation}")

    def verify(self, reference: ObjectRef, *, byte_size: int, sha256: str) -> None:
        contents = self.read_bytes(reference.name, reference.generation)
        actual_digest = hashlib.sha256(contents).hexdigest()
        if len(contents) != byte_size or actual_digest != sha256:
            raise PublicationError(f"digest verification failed for {reference.name}")

    def corrupt(self, reference: ObjectRef) -> None:
        versions = self.objects[reference.name]
        for version in versions:
            if version.generation == reference.generation:
                version.contents += b"corrupt"
                return
        raise AssertionError("reference not found")

    def _append(self, name: str, contents: bytes) -> ObjectRef:
        version = StoredVersion(self.next_generation, contents)
        self.next_generation += 1
        self.objects.setdefault(name, []).append(version)
        return self._ref(name, version)

    @staticmethod
    def _ref(name: str, version: StoredVersion) -> ObjectRef:
        return ObjectRef(
            name=name,
            generation=version.generation,
            byte_size=len(version.contents),
            sha256=hashlib.sha256(version.contents).hexdigest(),
        )


def source_book(book_id: str) -> Book:
    return Book(
        book_id=book_id,
        title=f"Title {book_id}",
        author=None,
        source_path=Path(f"{book_id}.json"),
        source_sha256="a" * 64,
        remedies=(Remedy(name="A", sections=(Section(title="Mind", passages=("text",)),)),),
    )


def spec(version: str) -> ArtifactSpec:
    return ArtifactSpec(
        corpus_version=version,
        corpus_hash=None,
        embedding=EmbeddingSpec(dimensions=2),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )


def build(tmp_path: Path, version: str, book_ids: tuple[str, ...] = ("alpha",)) -> BuiltRelease:
    source_books = tuple(source_book(book_id) for book_id in book_ids)
    chunks = tuple(chunk for item in source_books for chunk in chunk_book(item))
    return build_release(
        source_books,
        FakeProvider(),
        output_root=tmp_path / "output",
        spec=spec(version),
        evaluation=EvaluationGate(
            dataset_version="v1",
            dataset_sha256="d" * 64,
            corpus_hash=corpus_hash(chunks),
            result_sha256="e" * 64,
            metric="recallAt10",
            threshold=0.8,
            value=0.9,
            chosen_dimensions=2,
        ),
    )


def publisher(store: MemoryObjectStore, book_ids: tuple[str, ...] = ("alpha",)) -> CorpusPublisher:
    return CorpusPublisher(
        store,
        expected_book_ids=frozenset(book_ids),
        expected_compatibility=compatibility_from_artifact_spec(spec("requirements")),
        expected_artifact_schema_version=1,
    )


def test_stages_immutable_release_then_conditionally_activates_it(tmp_path: Path) -> None:
    release = build(tmp_path, "2026-08-14.one")
    store = MemoryObjectStore()
    service = publisher(store)

    staged = service.stage_release(release.release_directory)

    assert store.snapshot("corpora/active.json") is None
    manifest = json.loads(store.read_bytes(staged.name, staged.generation))
    assert manifest["corpusVersion"] == "2026-08-14.one"
    assert manifest["books"][0]["object"] == ("corpora/2026-08-14.one/books/alpha.sqlite")
    assert isinstance(manifest["books"][0]["generation"], int)

    active = service.activate(staged, expected_active_generation=0)

    pointer_ref = store.snapshot("corpora/active.json")
    assert pointer_ref is not None
    pointer = json.loads(store.read_bytes(pointer_ref.name, pointer_ref.generation))
    assert pointer["corpusVersion"] == "2026-08-14.one"
    assert pointer["manifestObject"] == staged.name
    assert pointer["manifestGeneration"] == staged.generation
    assert active.corpus_version == "2026-08-14.one"


def test_failed_or_corrupt_staging_never_changes_active_pointer(tmp_path: Path) -> None:
    release = build(tmp_path, "2026-08-14.failure", ("alpha", "beta"))
    store = MemoryObjectStore()
    store.fail_create_name = "corpora/2026-08-14.failure/books/beta.sqlite"
    service = publisher(store, ("alpha", "beta"))

    with pytest.raises(RuntimeError, match="injected"):
        service.publish(release.release_directory)
    assert store.snapshot("corpora/active.json") is None

    store = MemoryObjectStore()
    service = publisher(store, ("alpha", "beta"))
    staged = service.stage_release(release.release_directory)
    manifest = json.loads(store.read_bytes(staged.name, staged.generation))
    artifact_ref = ObjectRef(
        name=manifest["books"][0]["object"],
        generation=manifest["books"][0]["generation"],
        byte_size=manifest["books"][0]["byteSize"],
        sha256=manifest["books"][0]["sha256"],
    )
    store.corrupt(artifact_ref)
    with pytest.raises(PublicationError, match="digest verification"):
        service.activate(staged, expected_active_generation=0)
    assert store.snapshot("corpora/active.json") is None


def test_create_only_upload_and_incompatible_release_fail_before_activation(tmp_path: Path) -> None:
    release = build(tmp_path, "2026-08-14.immutable")
    store = MemoryObjectStore()
    service = publisher(store)
    service.stage_release(release.release_directory)

    with pytest.raises(PublicationConflict, match="already exists"):
        service.stage_release(release.release_directory)

    incompatible = build(tmp_path, "2026-08-14.incompatible")
    descriptor_path = incompatible.release_directory / "build.json"
    descriptor = json.loads(descriptor_path.read_text())
    descriptor["compatibility"]["embeddingDimensions"] = 3
    descriptor_path.write_text(json.dumps(descriptor))
    before = set(store.objects)
    with pytest.raises(PublicationError, match="incompatible"):
        service.stage_release(incompatible.release_directory)
    assert set(store.objects) == before


def test_concurrent_activation_conflicts_and_rollback_repoints_existing_manifest(
    tmp_path: Path,
) -> None:
    first = build(tmp_path, "2026-08-14.first")
    second = build(tmp_path, "2026-08-14.second")
    store = MemoryObjectStore()
    service = publisher(store)
    first_manifest = service.stage_release(first.release_directory)
    second_manifest = service.stage_release(second.release_directory)

    service.activate(first_manifest, expected_active_generation=0)
    with pytest.raises(PublicationConflict, match="precondition"):
        service.activate(second_manifest, expected_active_generation=0)

    pointer_before = store.snapshot("corpora/active.json")
    assert pointer_before is not None
    service.activate(second_manifest, expected_active_generation=pointer_before.generation)
    service.rollback("2026-08-14.first")
    pointer_after = store.snapshot("corpora/active.json")
    assert pointer_after is not None
    pointer = json.loads(store.read_bytes(pointer_after.name, pointer_after.generation))
    assert pointer["corpusVersion"] == "2026-08-14.first"
    assert store.snapshot(first_manifest.name) == first_manifest
