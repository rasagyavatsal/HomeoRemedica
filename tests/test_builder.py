from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest

from homeoremedica_corpus.artifacts import ArtifactSpec
from homeoremedica_corpus.builder import build_release
from homeoremedica_corpus.chunking import ChunkingPolicy
from homeoremedica_corpus.embeddings import EmbeddingSpec
from homeoremedica_corpus.sources import Book, CorpusValidationError, Remedy, Section


def book(book_id: str, passage: str) -> Book:
    return Book(
        book_id=book_id,
        title=f"Title {book_id}",
        author=None,
        source_path=Path(f"{book_id}.json"),
        source_sha256=book_id[0] * 64,
        remedies=(Remedy(name="A", sections=(Section(title="Mind", passages=(passage,)),)),),
    )


@dataclass
class BuilderProvider:
    oversized_marker: str | None = None
    dimensions: int = 2

    def __post_init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def count_tokens(self, text: str) -> int:
        self.events.append(("count", text))
        return 99 if self.oversized_marker and self.oversized_marker in text else 1

    def embed_document(self, text: str) -> tuple[float, ...]:
        self.events.append(("embed", text))
        return (1.0, 0.0)

    def embed_query(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0)


def artifact_spec() -> ArtifactSpec:
    return ArtifactSpec(
        corpus_version="2026-08-14.test",
        corpus_hash=None,
        embedding=EmbeddingSpec(dimensions=2, model_input_limit=10),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )


def test_build_preflights_all_books_before_embedding_and_publishes_complete_directory(
    tmp_path: Path,
) -> None:
    books = (book("alpha", "first"), book("beta", "second"))
    provider = BuilderProvider()

    release = build_release(
        books,
        provider,
        output_root=tmp_path / "output",
        spec=artifact_spec(),
        chunking=ChunkingPolicy(target_tokens=500, minimum_tokens=300),
    )

    assert [event for event, _ in provider.events] == ["count", "count", "embed", "embed"]
    assert release.release_directory == tmp_path / "output" / "2026-08-14.test"
    assert [artifact.book_id for artifact in release.artifacts] == ["alpha", "beta"]
    assert all(artifact.path.is_file() for artifact in release.artifacts)
    descriptor = json.loads((release.release_directory / "build.json").read_text())
    assert descriptor["corpusVersion"] == "2026-08-14.test"
    assert {item["bookId"] for item in descriptor["books"]} == {"alpha", "beta"}


def test_failed_preflight_leaves_no_release_and_makes_no_embedding_calls(tmp_path: Path) -> None:
    books = (book("alpha", "first"), book("beta", "oversized"))
    provider = BuilderProvider(oversized_marker="oversized")

    with pytest.raises(CorpusValidationError, match="beta"):
        build_release(
            books,
            provider,
            output_root=tmp_path / "output",
            spec=artifact_spec(),
        )

    assert [event for event, _ in provider.events] == ["count", "count"]
    assert not (tmp_path / "output" / "2026-08-14.test").exists()
