from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest

from chat.corpus import (
    EXPECTED_BOOK_IDS,
    ActivePointer,
    CorpusError,
    LocalCorpus,
    ReleaseManifest,
)
from corpus.artifacts import ArtifactSpec
from corpus.builder import build_release
from corpus.chunking import ChunkingPolicy
from corpus.embeddings import EmbeddingSpec
from corpus.sources import Book, Remedy, Section


def test_active_pointer_rejects_path_traversal() -> None:
    pointer = {
        "pointerSchemaVersion": 1,
        "corpusVersion": "v1",
        "manifestPath": "v1/manifest.json",
        "manifestByteSize": 1,
        "manifestSha256": "a" * 64,
    }

    with pytest.raises(ValueError):
        ActivePointer.model_validate({**pointer, "corpusVersion": "../outside"})
    with pytest.raises(ValueError):
        ActivePointer.model_validate({**pointer, "manifestPath": "v1/../secret.json"})


def test_release_manifest_rejects_path_traversal_in_book_ids() -> None:
    manifest = _manifest_data(
        [
            {
                "bookId": "../outside",
                "title": "Outside",
                "author": None,
                "sourceSha256": "a" * 64,
                "chunkCount": 1,
                "passageCount": 1,
            }
        ]
    )

    with pytest.raises(ValueError):
        ReleaseManifest.model_validate(manifest)


def test_local_loader_rejects_a_manifest_path_outside_the_active_release(tmp_path: Path) -> None:
    root = tmp_path / "corpus"
    root.mkdir()
    pointer = {
        "corpusVersion": "v1",
        "manifestByteSize": 1,
        "manifestPath": "other/manifest.json",
        "manifestSha256": "a" * 64,
        "pointerSchemaVersion": 1,
    }
    (root / "active.json").write_bytes(_json_bytes(pointer))

    with pytest.raises(CorpusError, match="manifest path"):
        LocalCorpus(root).load()


def test_local_loader_searches_the_shared_database_and_applies_book_filters(
    tmp_path: Path,
) -> None:
    root = _write_local_release(tmp_path)

    release = LocalCorpus(root).load()
    all_results = release.search("irritability", (1.0, 0.0, 0.0), book_ids=None, limit=4)
    filtered_results = release.search(
        "irritability", (1.0, 0.0, 0.0), book_ids=("kent-lectures",), limit=1
    )

    assert release.corpus_version == "v1"
    assert all_results[0].book_id == "kent-lectures"
    assert filtered_results[0].text == "Irritable and oversensitive."
    assert filtered_results[0].remedy_name == "NUX VOMICA"
    assert {result.book_id for result in all_results} <= EXPECTED_BOOK_IDS
    assert all(result.book_id == "kent-lectures" for result in filtered_results)
    assert (root / "v1/corpus.sqlite").is_file()
    assert not (root / "v1/books").exists()


def test_local_loader_rejects_a_tampered_shared_artifact(tmp_path: Path) -> None:
    root = _write_local_release(tmp_path)
    path = root / "v1/corpus.sqlite"
    path.write_bytes(path.read_bytes() + b"tampered")

    with pytest.raises(CorpusError, match="corrupt"):
        LocalCorpus(root).load()


@dataclass
class _FakeProvider:
    dimensions: int = 3

    def count_tokens(self, text: str) -> int:
        return 1

    def embed_document(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0, 0.0) if "Irritable" in text else (0.0, 1.0, 0.0)

    def embed_query(self, text: str) -> tuple[float, ...]:
        return (1.0, 0.0, 0.0)


def _write_local_release(tmp_path: Path) -> Path:
    books = tuple(
        _source_book(
            book_id,
            "Irritable and oversensitive." if book_id == "kent-lectures" else "Calm.",
        )
        for book_id in sorted(EXPECTED_BOOK_IDS)
    )
    output = tmp_path / "corpus"
    build_release(
        books,
        _FakeProvider(),
        output_root=output,
        spec=ArtifactSpec(
            corpus_version="v1",
            corpus_hash=None,
            embedding=EmbeddingSpec(dimensions=3),
            sqlite_version=sqlite3.sqlite_version,
            sqlite_vec_version="0.1.9",
            artifact_schema_version=2,
        ),
        chunking=ChunkingPolicy(target_tokens=500, minimum_tokens=300),
    )
    return output


def _source_book(book_id: str, passage: str) -> Book:
    return Book(
        book_id=book_id,
        title=f"Title {book_id}",
        author="James Tyler Kent",
        source_path=Path(f"{book_id}.json"),
        source_sha256="a" * 64,
        remedies=(
            Remedy(name="NUX VOMICA", sections=(Section(title="MIND", passages=(passage,)),)),
        ),
    )


def _manifest_data(books: list[dict[str, object]]) -> dict[str, object]:
    return {
        "artifactSchemaVersion": 2,
        "artifact": {
            "bookCount": len(books),
            "byteSize": 1,
            "chunkCount": sum(int(book["chunkCount"]) for book in books),
            "filename": "corpus.sqlite",
            "passageCount": sum(int(book["passageCount"]) for book in books),
            "sha256": "b" * 64,
        },
        "books": books,
        "compatibility": {
            "distanceFunction": "cosine",
            "documentTaskType": "RETRIEVAL_DOCUMENT",
            "embeddingDimensions": 3,
            "embeddingModel": "qwen/qwen3-embedding-8b",
            "embeddingNormalization": "l2",
            "modelInputLimit": 2048,
            "queryTaskType": "RETRIEVAL_QUERY",
            "sqliteVecVersion": "0.1.9",
            "sqliteVersion": sqlite3.sqlite_version,
        },
        "corpusHash": "b" * 64,
        "corpusVersion": "v1",
        "manifestSchemaVersion": 3,
    }


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()
