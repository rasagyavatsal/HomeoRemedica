from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
import sqlite_vec

from homeoremedica_chat.corpus import (
    EXPECTED_BOOK_IDS,
    ActivePointer,
    CorpusCache,
    CorpusError,
    ObjectData,
    ReleaseManifest,
)


class MemorySource:
    def __init__(self, objects: dict[tuple[str, int | None], ObjectData]) -> None:
        self.objects = objects

    def read(
        self,
        name: str,
        *,
        generation: int | None = None,
        max_bytes: int | None = None,
    ) -> ObjectData:
        object_data = self.objects[name, generation]
        if max_bytes is not None and len(object_data.content) > max_bytes:
            raise AssertionError(f"{name} exceeds the requested test limit")
        return object_data


def test_active_pointer_rejects_path_traversal() -> None:
    pointer = {
        "pointerSchemaVersion": 1,
        "corpusVersion": "v1",
        "manifestObject": "corpora/v1/manifest.json",
        "manifestGeneration": 1,
        "manifestByteSize": 1,
        "manifestSha256": "a" * 64,
    }

    with pytest.raises(ValueError):
        ActivePointer.model_validate({**pointer, "corpusVersion": "../outside"})
    with pytest.raises(ValueError):
        ActivePointer.model_validate({**pointer, "manifestObject": "corpora/../secret.json"})


def test_release_manifest_rejects_path_traversal_in_book_ids() -> None:
    manifest = {
        "manifestSchemaVersion": 1,
        "artifactSchemaVersion": 1,
        "corpusVersion": "v1",
        "corpusHash": "b" * 64,
        "compatibility": {
            "embeddingModel": "qwen/qwen3-embedding-8b",
            "embeddingDimensions": 3,
            "documentTaskType": "RETRIEVAL_DOCUMENT",
            "queryTaskType": "RETRIEVAL_QUERY",
            "embeddingNormalization": "l2",
            "distanceFunction": "cosine",
            "modelInputLimit": 2048,
            "sqliteVersion": sqlite3.sqlite_version,
            "sqliteVecVersion": "0.1.9",
        },
        "evaluation": {
            "datasetVersion": "test",
            "datasetSha256": "c" * 64,
            "corpusHash": "b" * 64,
            "resultSha256": "d" * 64,
            "metric": "recallAtK",
            "threshold": 0.8,
            "value": 1.0,
            "chosenDimensions": 3,
        },
        "books": [
            {
                "bookId": "../outside",
                "title": "Book",
                "author": None,
                "object": "corpora/v1/books/../outside.sqlite",
                "generation": 1,
                "byteSize": 1,
                "sha256": "e" * 64,
                "sourceSha256": "f" * 64,
                "chunkCount": 1,
                "passageCount": 1,
            }
        ],
    }

    with pytest.raises(ValueError):
        ReleaseManifest.model_validate(manifest)


def test_sync_rejects_a_manifest_object_outside_the_active_release(tmp_path: Path) -> None:
    pointer = _json_bytes({
        "corpusVersion": "v1",
        "manifestByteSize": 1,
        "manifestGeneration": 11,
        "manifestObject": "corpora/other/manifest.json",
        "manifestSha256": "a" * 64,
        "pointerSchemaVersion": 1,
    })
    source = MemorySource({
        ("corpora/active.json", None): ObjectData(
            name="corpora/active.json", generation=10, content=pointer
        ),
    })

    cache = CorpusCache(tmp_path / "cache")
    with pytest.raises(CorpusError, match="unexpected manifest object path"):
        cache.sync(source)


def test_sync_opens_a_verified_release_and_searches_its_hybrid_index(tmp_path: Path) -> None:
    books = []
    objects: dict[tuple[str, int | None], ObjectData] = {}
    for index, book_id in enumerate(sorted(EXPECTED_BOOK_IDS), start=1):
        artifact = _artifact_bytes(tmp_path / book_id, book_id=book_id)
        artifact_digest = hashlib.sha256(artifact).hexdigest()
        object_name = f"corpora/v1/books/{book_id}.sqlite"
        books.append({
            "author": "James Tyler Kent",
            "bookId": book_id,
            "byteSize": len(artifact),
            "chunkCount": 2,
            "generation": 21 + index,
            "object": object_name,
            "passageCount": 2,
            "sha256": artifact_digest,
            "sourceSha256": "a" * 64,
            "title": "Kent's Lectures",
        })
        objects[object_name, 21 + index] = ObjectData(
            name=object_name, generation=21 + index, content=artifact
        )

    manifest = _json_bytes({
        "artifactSchemaVersion": 1,
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
        "evaluation": {
            "chosenDimensions": 3,
            "corpusHash": "b" * 64,
            "datasetSha256": "c" * 64,
            "datasetVersion": "test",
            "metric": "recallAtK",
            "resultSha256": "d" * 64,
            "threshold": 0.8,
            "value": 1.0,
        },
        "manifestSchemaVersion": 1,
    })
    pointer = _json_bytes({
        "corpusVersion": "v1",
        "manifestByteSize": len(manifest),
        "manifestGeneration": 11,
        "manifestObject": "corpora/v1/manifest.json",
        "manifestSha256": hashlib.sha256(manifest).hexdigest(),
        "pointerSchemaVersion": 1,
    })
    objects.update({
        ("corpora/active.json", None): ObjectData(
            name="corpora/active.json", generation=10, content=pointer
        ),
        ("corpora/v1/manifest.json", 11): ObjectData(
            name="corpora/v1/manifest.json", generation=11, content=manifest
        ),
    })
    source = MemorySource(objects)

    release = CorpusCache(tmp_path / "cache").sync(source)
    results = release.search("irritability", (1.0, 0.0, 0.0), book_ids=("kent-lectures",), limit=1)

    assert release.corpus_version == "v1"
    assert results[0].chunk_id == "chunk-irritable"
    assert results[0].remedy_name == "NUX VOMICA"
    assert (tmp_path / "cache/v1/books/kent-lectures.sqlite").read_bytes() == source.objects[
        "corpora/v1/books/kent-lectures.sqlite", 25
    ].content


def _artifact_bytes(tmp_path: Path, *, book_id: str = "kent-lectures") -> bytes:
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
