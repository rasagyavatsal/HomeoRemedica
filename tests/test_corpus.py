from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
import sqlite_vec

from chat.corpus import (
    EXPECTED_BOOK_IDS,
    ActivePointer,
    CorpusError,
    LocalCorpus,
    ReleaseManifest,
)


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
                "filename": "books/../outside.sqlite",
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


def test_local_loader_opens_a_verified_release_and_searches_its_hybrid_index(
    tmp_path: Path,
) -> None:
    root = _write_local_release(tmp_path)

    release = LocalCorpus(root).load()
    results = release.search(
        "irritability", (1.0, 0.0, 0.0), book_ids=("kent-lectures",), limit=1
    )

    assert release.corpus_version == "v1"
    assert results[0].chunk_id == "chunk-irritable"
    assert results[0].remedy_name == "NUX VOMICA"
    assert (root / "v1/books/kent-lectures.sqlite").is_file()


def test_local_loader_rejects_a_tampered_artifact(tmp_path: Path) -> None:
    root = _write_local_release(tmp_path)
    path = root / "v1/books/kent-lectures.sqlite"
    path.write_bytes(path.read_bytes() + b"tampered")

    with pytest.raises(CorpusError, match="corrupt"):
        LocalCorpus(root).load()


def _write_local_release(tmp_path: Path) -> Path:
    root = tmp_path / "corpus"
    release = root / "v1/books"
    release.mkdir(parents=True)
    books = []
    for index, book_id in enumerate(sorted(EXPECTED_BOOK_IDS), start=1):
        artifact = _artifact_bytes(tmp_path / f"artifact-{index}", book_id=book_id)
        path = release / f"{book_id}.sqlite"
        path.write_bytes(artifact)
        books.append(
            {
                "author": "James Tyler Kent",
                "bookId": book_id,
                "byteSize": len(artifact),
                "chunkCount": 2,
                "filename": f"books/{book_id}.sqlite",
                "passageCount": 2,
                "sha256": hashlib.sha256(artifact).hexdigest(),
                "sourceSha256": "a" * 64,
                "title": "Kent's Lectures",
            }
        )

    manifest = _manifest_data(books)
    manifest_bytes = _json_bytes(manifest)
    (root / "v1/manifest.json").write_bytes(manifest_bytes)
    (root / "active.json").write_bytes(
        _json_bytes(
            {
                "corpusVersion": "v1",
                "manifestByteSize": len(manifest_bytes),
                "manifestPath": "v1/manifest.json",
                "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                "pointerSchemaVersion": 1,
            }
        )
    )
    return root


def _manifest_data(books: list[dict[str, object]]) -> dict[str, object]:
    compatibility = {
        "distanceFunction": "cosine",
        "documentTaskType": "RETRIEVAL_DOCUMENT",
        "embeddingDimensions": 3,
        "embeddingModel": "qwen/qwen3-embedding-8b",
        "embeddingNormalization": "l2",
        "modelInputLimit": 2048,
        "queryTaskType": "RETRIEVAL_QUERY",
        "sqliteVecVersion": "0.1.9",
        "sqliteVersion": sqlite3.sqlite_version,
    }
    return {
        "artifactSchemaVersion": 1,
        "books": books,
        "compatibility": compatibility,
        "corpusHash": "b" * 64,
        "corpusVersion": "v1",
        "manifestSchemaVersion": 2,
    }


def _artifact_bytes(tmp_path: Path, *, book_id: str) -> bytes:
    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "book.sqlite"
    connection = sqlite3.connect(path)
    connection.enable_load_extension(True)
    sqlite_vec.load(connection)
    connection.enable_load_extension(False)
    connection.executescript(
        """
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE chunks (
            rowid INTEGER PRIMARY KEY,
            id TEXT NOT NULL UNIQUE,
            book_id TEXT NOT NULL,
            remedy_slug TEXT NOT NULL,
            remedy_name TEXT NOT NULL,
            section_slug TEXT NOT NULL,
            section_title TEXT NOT NULL,
            passage_indexes TEXT NOT NULL,
            part INTEGER NOT NULL,
            text TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
            text, remedy_name, section_title, content='chunks', content_rowid='rowid',
            tokenize='porter unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE chunk_vectors USING vec0(
            chunk_rowid INTEGER PRIMARY KEY,
            embedding float[3] distance_metric=cosine
        );
        """
    )
    rows = (
        (
            1,
            "chunk-irritable",
            "nux-vomica",
            "NUX VOMICA",
            "mind",
            "MIND",
            "Irritable and oversensitive.",
            (1.0, 0.0, 0.0),
        ),
        (
            2,
            "chunk-calm",
            "pulsatilla",
            "PULSATILLA",
            "mind",
            "MIND",
            "Mild and yielding disposition.",
            (0.0, 1.0, 0.0),
        ),
    )
    for rowid, chunk_id, remedy_slug, remedy_name, section_slug, section, text, vector in rows:
        connection.execute(
            "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, '[0]', 1, ?)",
            (rowid, chunk_id, book_id, remedy_slug, remedy_name, section_slug, section, text),
        )
        connection.execute(
            "INSERT INTO chunk_vectors(chunk_rowid, embedding) VALUES (?, ?)",
            (rowid, sqlite_vec.serialize_float32(vector)),
        )
    connection.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
    metadata = {
        "artifact_schema_version": "1",
        "book_author": "James Tyler Kent",
        "book_id": book_id,
        "book_title": "Kent's Lectures",
        "chunk_count": "2",
        "corpus_hash": "b" * 64,
        "corpus_version": "v1",
        "distance_function": "cosine",
        "document_task_type": "RETRIEVAL_DOCUMENT",
        "embedding_dimensions": "3",
        "embedding_model": "qwen/qwen3-embedding-8b",
        "embedding_normalization": "l2",
        "fts_tokenizer": "porter unicode61 remove_diacritics 2",
        "model_input_limit": "2048",
        "passage_count": "2",
        "query_task_type": "RETRIEVAL_QUERY",
        "source_sha256": "a" * 64,
        "sqlite_vec_version": "0.1.9",
        "sqlite_version": sqlite3.sqlite_version,
    }
    connection.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())
    connection.commit()
    connection.close()
    return path.read_bytes()


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()
