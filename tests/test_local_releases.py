from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest

from corpus.artifacts import ArtifactSpec
from corpus.builder import activate_release, build_release
from corpus.chunking import ChunkingPolicy
from corpus.embeddings import EmbeddingSpec
from corpus.sources import Book, CorpusValidationError, Remedy, Section


@dataclass
class FakeProvider:
    dimensions: int = 2

    def count_tokens(self, text: str) -> int:
        return 1

    def embed_document(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0)

    def embed_query(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0)


def source_book(book_id: str) -> Book:
    return Book(
        book_id=book_id,
        title=f"Title {book_id}",
        author=None,
        source_path=Path(f"{book_id}.json"),
        source_sha256="a" * 64,
        remedies=(Remedy(name="A", sections=(Section(title="Mind", passages=("text",)),)),),
    )


def artifact_spec(version: str) -> ArtifactSpec:
    return ArtifactSpec(
        corpus_version=version,
        corpus_hash=None,
        embedding=EmbeddingSpec(dimensions=2),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )


def test_build_creates_a_manifest_and_atomically_activates_the_release(tmp_path: Path) -> None:
    output = tmp_path / "artifacts" / "corpus"
    release = build_release(
        (source_book("alpha"),),
        FakeProvider(),
        output_root=output,
        spec=artifact_spec("2026-09-11.test"),
        chunking=ChunkingPolicy(target_tokens=500, minimum_tokens=300),
    )

    assert release.release_directory == output / "2026-09-11.test"
    assert (release.release_directory / "manifest.json").is_file()
    assert (release.release_directory / "books/alpha.sqlite").is_file()
    active = json.loads((output / "active.json").read_text())
    assert active["corpusVersion"] == "2026-09-11.test"
    assert active["manifestPath"] == "2026-09-11.test/manifest.json"


def test_failed_preflight_leaves_no_release_or_active_pointer(tmp_path: Path) -> None:
    class OversizedProvider(FakeProvider):
        def count_tokens(self, text: str) -> int:
            return 99_999

    output = tmp_path / "artifacts" / "corpus"
    with pytest.raises(CorpusValidationError, match="alpha"):
        build_release(
            (source_book("alpha"),),
            OversizedProvider(),
            output_root=output,
            spec=artifact_spec("2026-09-11.test"),
        )

    assert not (output / "2026-09-11.test").exists()
    assert not (output / "active.json").exists()


def test_activate_release_rechecks_existing_files(tmp_path: Path) -> None:
    output = tmp_path / "artifacts" / "corpus"
    release = build_release(
        (source_book("alpha"),),
        FakeProvider(),
        output_root=output,
        spec=artifact_spec("2026-09-11.test"),
    )
    (output / "active.json").unlink()
    artifact = release.release_directory / "books/alpha.sqlite"
    artifact.write_bytes(artifact.read_bytes() + b"tampered")

    with pytest.raises(CorpusValidationError, match="digest verification"):
        activate_release(output, release.corpus_version)
