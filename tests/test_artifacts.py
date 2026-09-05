from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import sqlite_vec

from homeoremedica_corpus.artifacts import (
    ArtifactSpec,
    create_book_artifact,
    validate_book_artifact,
)
from homeoremedica_corpus.chunking import ChunkingPolicy, chunk_book, corpus_hash
from homeoremedica_corpus.embeddings import EmbeddedChunk, EmbeddingSpec
from homeoremedica_corpus.retrieval import FTS5_TOKENIZER
from homeoremedica_corpus.sources import Book, Remedy, Section


def fixture_book() -> Book:
    return Book(
        book_id="test-book",
        title="Test Materia Medica",
        author="Test Author",
        source_path=Path("test-book.json"),
        source_sha256="b" * 64,
        remedies=(
            Remedy(
                name="ABIES NIGRA",
                sections=(Section(title="Mind", passages=("Irritable.", "Restless.")),),
            ),
        ),
    )


def load_vec(connection: sqlite3.Connection) -> None:
    connection.enable_load_extension(True)
    sqlite_vec.load(connection)
    connection.enable_load_extension(False)


def test_creates_searchable_validated_per_book_artifact(tmp_path: Path) -> None:
    book = fixture_book()
    chunks = chunk_book(
        book,
        ChunkingPolicy(target_tokens=1, minimum_tokens=1),
        lambda text: len(text.split()),
    )
    embedded = (
        EmbeddedChunk(chunk=chunks[0], embedding=(1.0, 0.0)),
        EmbeddedChunk(chunk=chunks[1], embedding=(0.0, 1.0)),
    )
    spec = ArtifactSpec(
        corpus_version="2026-08-14.test",
        corpus_hash=corpus_hash(chunks),
        embedding=EmbeddingSpec(dimensions=2),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )
    path = tmp_path / "test-book.sqlite"

    artifact = create_book_artifact(path, book, embedded, spec)
    validated = validate_book_artifact(path, spec, expected_book=book, expected_chunks=chunks)

    assert validated == artifact
    assert artifact.book_id == "test-book"
    assert artifact.chunk_count == 2
    assert artifact.passage_count == 2
    assert artifact.byte_size == path.stat().st_size
    assert len(artifact.sha256) == 64

    connection = sqlite3.connect(path)
    load_vec(connection)
    metadata = dict(connection.execute("SELECT key, value FROM metadata"))
    assert metadata["corpus_version"] == "2026-08-14.test"
    assert metadata["book_id"] == "test-book"
    assert metadata["embedding_model"] == "qwen/qwen3-embedding-8b"
    assert metadata["embedding_dimensions"] == "2"
    assert metadata["embedding_normalization"] == "l2"
    assert metadata["distance_function"] == "cosine"
    assert metadata["fts_tokenizer"] == FTS5_TOKENIZER
    assert metadata["sqlite_version"] == sqlite3.sqlite_version
    assert metadata["sqlite_vec_version"] == "0.1.9"
    assert connection.execute(
        "SELECT c.id FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid "
        "WHERE chunks_fts MATCH 'irritable'"
    ).fetchone() == (chunks[0].id,)
    fts_schema = connection.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'"
    ).fetchone()[0]
    assert f"tokenize='{FTS5_TOKENIZER}'" in fts_schema
    query_vector = connection.execute(
        "SELECT embedding FROM chunk_vectors WHERE chunk_rowid = 1"
    ).fetchone()[0]
    assert connection.execute(
        "SELECT chunk_rowid FROM chunk_vectors WHERE embedding MATCH ? AND k = 1",
        (query_vector,),
    ).fetchone() == (1,)
    stored_indexes = connection.execute(
        "SELECT passage_indexes FROM chunks ORDER BY rowid"
    ).fetchall()
    assert [json.loads(row[0]) for row in stored_indexes] == [[0], [1]]
    connection.close()


def test_refuses_to_overwrite_an_artifact(tmp_path: Path) -> None:
    book = fixture_book()
    chunks = chunk_book(book)
    embedded = (EmbeddedChunk(chunk=chunks[0], embedding=(1.0, 0.0)),)
    spec = ArtifactSpec(
        corpus_version="2026-08-14.test",
        corpus_hash=corpus_hash(chunks),
        embedding=EmbeddingSpec(dimensions=2),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )
    path = tmp_path / "artifact.sqlite"
    path.write_bytes(b"existing")

    try:
        create_book_artifact(path, book, embedded, spec)
    except FileExistsError as error:
        assert str(path) in str(error)
    else:
        raise AssertionError("existing artifact was overwritten")
    assert path.read_bytes() == b"existing"
