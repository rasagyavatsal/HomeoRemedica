from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import sqlite_vec

from corpus.artifacts import (
    FTS5_TOKENIZER,
    ArtifactSpec,
    create_corpus_artifact,
    validate_corpus_artifact,
)
from corpus.chunking import ChunkingPolicy, chunk_book, corpus_hash
from corpus.embeddings import EmbeddedChunk, EmbeddingSpec
from corpus.sources import Book, Remedy, Section


def fixture_book(book_id: str, passage: str) -> Book:
    return Book(
        book_id=book_id,
        title=f"Test {book_id}",
        author=f"Author {book_id}",
        source_path=Path(f"{book_id}.json"),
        source_sha256=book_id[0] * 64,
        remedies=(
            Remedy(
                name="ABIES NIGRA",
                sections=(Section(title="Mind", passages=(passage, "Restless.")),),
            ),
        ),
    )


def load_vec(connection: sqlite3.Connection) -> None:
    connection.enable_load_extension(True)
    sqlite_vec.load(connection)
    connection.enable_load_extension(False)


def test_creates_one_searchable_database_with_complete_book_inventory(tmp_path: Path) -> None:
    books = (fixture_book("alpha", "Irritable."), fixture_book("beta", "Drowsy."))
    chunks = tuple(
        chunk
        for book in books
        for chunk in chunk_book(
            book,
            ChunkingPolicy(target_tokens=1, minimum_tokens=1),
            lambda text: len(text.split()),
        )
    )
    embedded = tuple(
        EmbeddedChunk(
            chunk=chunk,
            embedding=(1.0, 0.0) if chunk.book_id == "alpha" else (0.0, 1.0),
        )
        for chunk in chunks
    )
    spec = ArtifactSpec(
        corpus_version="2026-08-14.test",
        corpus_hash=corpus_hash(chunks),
        embedding=EmbeddingSpec(dimensions=2),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )
    path = tmp_path / "corpus.sqlite"

    artifact = create_corpus_artifact(path, books, embedded, spec)
    validated = validate_corpus_artifact(
        path,
        spec,
        expected_books=books,
        expected_chunks=chunks,
    )

    assert validated == artifact
    assert artifact.path == path
    assert [book.book_id for book in artifact.books] == ["alpha", "beta"]
    assert artifact.chunk_count == 4
    assert artifact.passage_count == 4
    assert artifact.byte_size == path.stat().st_size
    assert len(artifact.sha256) == 64

    connection = sqlite3.connect(path)
    load_vec(connection)
    metadata = dict(connection.execute("SELECT key, value FROM metadata"))
    assert metadata["corpus_version"] == "2026-08-14.test"
    assert metadata["book_count"] == "2"
    assert metadata["chunk_count"] == "4"
    assert metadata["embedding_model"] == "qwen/qwen3-embedding-8b"
    assert metadata["embedding_dimensions"] == "2"
    assert metadata["embedding_normalization"] == "l2"
    assert metadata["distance_function"] == "cosine"
    assert metadata["fts_tokenizer"] == FTS5_TOKENIZER
    assert metadata["sqlite_version"] == sqlite3.sqlite_version
    assert metadata["sqlite_vec_version"] == "0.1.9"
    assert connection.execute("SELECT count(*) FROM books").fetchone() == (2,)
    assert connection.execute(
        "SELECT book_id, title, author FROM books ORDER BY book_id"
    ).fetchall() == [
        ("alpha", "Test alpha", "Author alpha"),
        ("beta", "Test beta", "Author beta"),
    ]
    assert connection.execute(
        "SELECT c.book_id FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid "
        "WHERE chunks_fts MATCH 'irritable'"
    ).fetchone() == ("alpha",)
    assert connection.execute(
        "SELECT c.book_id FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid "
        "WHERE chunks_fts MATCH 'drowsy'"
    ).fetchone() == ("beta",)
    fts_schema = connection.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'"
    ).fetchone()[0]
    assert f"tokenize='{FTS5_TOKENIZER}'" in fts_schema
    vector_schema = connection.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'chunk_vectors'"
    ).fetchone()[0]
    assert "book_id TEXT partition key" in vector_schema
    query_vector = connection.execute(
        "SELECT embedding FROM chunk_vectors WHERE chunk_rowid = 1"
    ).fetchone()[0]
    assert (1,) in connection.execute(
        "SELECT chunk_rowid FROM chunk_vectors WHERE embedding MATCH ? AND k = 2",
        (query_vector,),
    ).fetchall()
    stored_indexes = connection.execute(
        "SELECT passage_indexes FROM chunks ORDER BY rowid"
    ).fetchall()
    assert [json.loads(row[0]) for row in stored_indexes] == [[0], [1], [0], [1]]
    connection.close()


def test_refuses_to_overwrite_an_artifact(tmp_path: Path) -> None:
    book = fixture_book("alpha", "Irritable.")
    chunks = chunk_book(book)
    embedded = (EmbeddedChunk(chunk=chunks[0], embedding=(1.0, 0.0)),)
    spec = ArtifactSpec(
        corpus_version="2026-08-14.test",
        corpus_hash=corpus_hash((chunks[0],)),
        embedding=EmbeddingSpec(dimensions=2),
        sqlite_version=sqlite3.sqlite_version,
        sqlite_vec_version="0.1.9",
    )
    path = tmp_path / "corpus.sqlite"
    path.write_bytes(b"existing")

    try:
        create_corpus_artifact(path, (book,), embedded, spec)
    except FileExistsError as error:
        assert str(path) in str(error)
    else:
        raise AssertionError("existing artifact was overwritten")
    assert path.read_bytes() == b"existing"
