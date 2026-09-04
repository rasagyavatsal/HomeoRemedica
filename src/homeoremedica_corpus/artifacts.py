from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import sqlite_vec

from homeoremedica_corpus.chunking import Chunk
from homeoremedica_corpus.embeddings import EmbeddedChunk, EmbeddingSpec
from homeoremedica_corpus.retrieval import FTS5_TOKENIZER
from homeoremedica_corpus.sources import Book, CorpusValidationError


@dataclass(frozen=True, slots=True)
class ArtifactSpec:
    corpus_version: str
    corpus_hash: str | None
    embedding: EmbeddingSpec
    sqlite_version: str
    sqlite_vec_version: str
    artifact_schema_version: int = 1

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", self.corpus_version):
            raise ValueError("corpus version must be a safe non-empty release identifier")
        if self.corpus_hash is not None and not re.fullmatch(r"[0-9a-f]{64}", self.corpus_hash):
            raise ValueError("corpus hash must be a lowercase SHA-256 digest")
        if self.artifact_schema_version <= 0:
            raise ValueError("artifact schema version must be positive")


@dataclass(frozen=True, slots=True)
class BuiltArtifact:
    book_id: str
    title: str
    author: str | None
    source_sha256: str
    path: Path
    chunk_count: int
    passage_count: int
    byte_size: int
    sha256: str


def create_book_artifact(
    path: Path,
    book: Book,
    embedded_chunks: Iterable[EmbeddedChunk],
    spec: ArtifactSpec,
) -> BuiltArtifact:
    """Create one immutable SQLite artifact without exposing partial output."""
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite artifact: {path}")
    chunks = tuple(embedded_chunks)
    if not chunks:
        raise CorpusValidationError(f"{book.book_id}: cannot build an artifact with no chunks")
    if any(item.chunk.book_id != book.book_id for item in chunks):
        raise CorpusValidationError(f"{book.book_id}: artifact received a chunk from another book")
    if len({item.chunk.id for item in chunks}) != len(chunks):
        raise CorpusValidationError(f"{book.book_id}: duplicate chunk IDs")
    _check_runtime(spec)
    if spec.corpus_hash is None:
        raise ValueError("artifact spec requires the complete corpus hash")

    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
    ) as temporary_file:
        temporary_path = Path(temporary_file.name)
    try:
        _write_database(temporary_path, book, chunks, spec)
        validate_book_artifact(
            temporary_path,
            spec,
            expected_book=book,
            expected_chunks=tuple(item.chunk for item in chunks),
        )
        try:
            os.link(temporary_path, path)
        except FileExistsError as error:
            raise FileExistsError(f"Refusing to overwrite artifact: {path}") from error
        return validate_book_artifact(
            path,
            spec,
            expected_book=book,
            expected_chunks=tuple(item.chunk for item in chunks),
        )
    finally:
        temporary_path.unlink(missing_ok=True)


def validate_book_artifact(
    path: Path,
    spec: ArtifactSpec,
    *,
    expected_book: Book | None = None,
    expected_chunks: Iterable[Chunk] | None = None,
) -> BuiltArtifact:
    """Validate schema, search indexes, metadata, content, and SQLite integrity."""
    _check_runtime(spec)
    if spec.corpus_hash is None:
        raise ValueError("artifact spec requires the complete corpus hash")
    if not path.is_file():
        raise CorpusValidationError(f"Artifact does not exist: {path}")

    chunks = tuple(expected_chunks) if expected_chunks is not None else None
    connection = _connect(path, readonly=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise CorpusValidationError(f"{path}: SQLite integrity_check failed: {integrity}")
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise CorpusValidationError(f"{path}: foreign key violations: {foreign_key_errors}")

        required_tables = {"metadata", "chunks", "chunks_fts", "chunk_vectors"}
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            )
        }
        missing_tables = required_tables - tables
        if missing_tables:
            raise CorpusValidationError(
                f"{path}: missing artifact tables: {sorted(missing_tables)}"
            )

        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        _validate_metadata(path, metadata, spec, expected_book, chunks)
        chunk_count = _single_int(connection, "SELECT count(*) FROM chunks")
        fts_count = _single_int(connection, "SELECT count(*) FROM chunks_fts")
        vector_count = _single_int(connection, "SELECT count(*) FROM chunk_vectors")
        expected_count = int(metadata["chunk_count"])
        if (chunk_count, fts_count, vector_count) != (expected_count,) * 3:
            raise CorpusValidationError(
                f"{path}: inconsistent chunk/index counts "
                f"(chunks={chunk_count}, fts={fts_count}, vectors={vector_count}, "
                f"expected={expected_count})"
            )
        _validate_stored_chunks(connection, path, chunks)
        _validate_fts(connection, path)
        _validate_vectors(connection, path, spec.embedding.dimensions)
    except sqlite3.DatabaseError as error:
        raise CorpusValidationError(f"{path}: invalid SQLite artifact: {error}") from error
    finally:
        connection.close()

    return BuiltArtifact(
        book_id=metadata["book_id"],
        title=metadata["book_title"],
        author=metadata["book_author"] or None,
        source_sha256=metadata["source_sha256"],
        path=path,
        chunk_count=int(metadata["chunk_count"]),
        passage_count=int(metadata["passage_count"]),
        byte_size=path.stat().st_size,
        sha256=sha256_file(path),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for block in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_database(
    path: Path,
    book: Book,
    embedded_chunks: tuple[EmbeddedChunk, ...],
    spec: ArtifactSpec,
) -> None:
    connection = _connect(path, readonly=False)
    try:
        connection.execute("PRAGMA page_size = 4096")
        connection.execute("PRAGMA journal_mode = DELETE")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(f"PRAGMA user_version = {spec.artifact_schema_version}")
        connection.executescript(
            f"""
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE chunks (
                rowid INTEGER PRIMARY KEY,
                id TEXT NOT NULL UNIQUE,
                book_id TEXT NOT NULL,
                remedy_slug TEXT NOT NULL,
                remedy_name TEXT NOT NULL,
                section_slug TEXT NOT NULL,
                section_title TEXT NOT NULL,
                passage_indexes TEXT NOT NULL CHECK(json_valid(passage_indexes)),
                part INTEGER NOT NULL CHECK(part > 0),
                text TEXT NOT NULL CHECK(length(text) > 0)
            );

            CREATE INDEX chunks_remedy_section
                ON chunks(remedy_slug, section_slug, part);

            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                text,
                remedy_name,
                section_title,
                content='chunks',
                content_rowid='rowid',
                tokenize='{FTS5_TOKENIZER}'
            );

            CREATE VIRTUAL TABLE chunk_vectors USING vec0(
                chunk_rowid INTEGER PRIMARY KEY,
                embedding float[{spec.embedding.dimensions}] distance_metric=cosine
            );
            """
        )

        for rowid, item in enumerate(embedded_chunks, start=1):
            chunk = item.chunk
            if len(item.embedding) != spec.embedding.dimensions:
                raise CorpusValidationError(
                    f"{book.book_id} / {chunk.id}: expected {spec.embedding.dimensions} "
                    f"embedding dimensions, got {len(item.embedding)}"
                )
            norm = math.sqrt(math.fsum(value * value for value in item.embedding))
            if not math.isclose(norm, 1.0, rel_tol=1e-5, abs_tol=1e-5):
                raise CorpusValidationError(
                    f"{book.book_id} / {chunk.id}: embedding is not L2 normalized"
                )
            connection.execute(
                """
                INSERT INTO chunks(
                    rowid, id, book_id, remedy_slug, remedy_name, section_slug,
                    section_title, passage_indexes, part, text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rowid,
                    chunk.id,
                    chunk.book_id,
                    chunk.remedy_slug,
                    chunk.remedy_name,
                    chunk.section_slug,
                    chunk.section_title,
                    json.dumps(chunk.passage_indexes, separators=(",", ":")),
                    chunk.part,
                    chunk.text,
                ),
            )
            connection.execute(
                "INSERT INTO chunk_vectors(chunk_rowid, embedding) VALUES (?, ?)",
                (rowid, sqlite_vec.serialize_float32(list(item.embedding))),
            )

        connection.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
        passage_count = sum(len(item.chunk.passage_indexes) for item in embedded_chunks)
        metadata = _metadata(book, len(embedded_chunks), passage_count, spec)
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)", sorted(metadata.items())
        )
        connection.commit()
        connection.execute("PRAGMA optimize")
        connection.execute("VACUUM")
    finally:
        connection.close()


def _metadata(
    book: Book, chunk_count: int, passage_count: int, spec: ArtifactSpec
) -> dict[str, str]:
    return {
        "artifact_schema_version": str(spec.artifact_schema_version),
        "book_author": book.author or "",
        "book_id": book.book_id,
        "book_title": book.title,
        "chunk_count": str(chunk_count),
        "corpus_hash": spec.corpus_hash or "",
        "corpus_version": spec.corpus_version,
        "distance_function": spec.embedding.distance_function,
        "document_task_type": spec.embedding.document_task_type,
        "embedding_dimensions": str(spec.embedding.dimensions),
        "embedding_model": spec.embedding.model,
        "embedding_normalization": spec.embedding.normalization,
        "fts_tokenizer": FTS5_TOKENIZER,
        "model_input_limit": str(spec.embedding.model_input_limit),
        "passage_count": str(passage_count),
        "query_task_type": spec.embedding.query_task_type,
        "source_sha256": book.source_sha256,
        "sqlite_vec_version": spec.sqlite_vec_version,
        "sqlite_version": spec.sqlite_version,
    }


def _validate_metadata(
    path: Path,
    actual: dict[str, str],
    spec: ArtifactSpec,
    book: Book | None,
    chunks: tuple[Chunk, ...] | None,
) -> None:
    shared = {
        "artifact_schema_version": str(spec.artifact_schema_version),
        "corpus_hash": spec.corpus_hash or "",
        "corpus_version": spec.corpus_version,
        "distance_function": spec.embedding.distance_function,
        "document_task_type": spec.embedding.document_task_type,
        "embedding_dimensions": str(spec.embedding.dimensions),
        "embedding_model": spec.embedding.model,
        "embedding_normalization": spec.embedding.normalization,
        "fts_tokenizer": FTS5_TOKENIZER,
        "model_input_limit": str(spec.embedding.model_input_limit),
        "query_task_type": spec.embedding.query_task_type,
        "sqlite_vec_version": spec.sqlite_vec_version,
        "sqlite_version": spec.sqlite_version,
    }
    expected = dict(shared)
    if book is not None:
        expected.update(
            {
                "book_author": book.author or "",
                "book_id": book.book_id,
                "book_title": book.title,
                "source_sha256": book.source_sha256,
            }
        )
    if chunks is not None:
        expected.update(
            {
                "chunk_count": str(len(chunks)),
                "passage_count": str(sum(len(chunk.passage_indexes) for chunk in chunks)),
            }
        )
    missing = sorted(set(expected) - set(actual))
    mismatched = sorted(key for key, value in expected.items() if actual.get(key) != value)
    required = {
        "book_author",
        "book_id",
        "book_title",
        "source_sha256",
        "chunk_count",
        "passage_count",
    }
    missing.extend(sorted(required - set(actual)))
    if missing or mismatched:
        raise CorpusValidationError(
            f"{path}: invalid artifact metadata (missing={sorted(set(missing))}, "
            f"mismatched={mismatched})"
        )


def _validate_stored_chunks(
    connection: sqlite3.Connection, path: Path, expected: tuple[Chunk, ...] | None
) -> None:
    rows = connection.execute(
        """
        SELECT id, book_id, remedy_slug, remedy_name, section_slug, section_title,
               passage_indexes, part, text
        FROM chunks ORDER BY rowid
        """
    ).fetchall()
    for row in rows:
        indexes = json.loads(row[6])
        if (
            not isinstance(indexes, list)
            or not indexes
            or not all(isinstance(index, int) and index >= 0 for index in indexes)
            or indexes != sorted(set(indexes))
        ):
            raise CorpusValidationError(f"{path}: invalid stored passage indexes for {row[0]}")
    if expected is None:
        return
    expected_rows = [
        (
            chunk.id,
            chunk.book_id,
            chunk.remedy_slug,
            chunk.remedy_name,
            chunk.section_slug,
            chunk.section_title,
            json.dumps(chunk.passage_indexes, separators=(",", ":")),
            chunk.part,
            chunk.text,
        )
        for chunk in expected
    ]
    if rows != expected_rows:
        raise CorpusValidationError(f"{path}: stored chunks differ from validated source chunks")


def _validate_fts(connection: sqlite3.Connection, path: Path) -> None:
    first = connection.execute("SELECT rowid, text FROM chunks ORDER BY rowid LIMIT 1").fetchone()
    if first is None:
        raise CorpusValidationError(f"{path}: artifact contains no chunks")
    tokens = re.findall(r"\w+", first[1], flags=re.UNICODE)
    if not tokens:
        raise CorpusValidationError(f"{path}: first chunk has no searchable FTS token")
    matches = connection.execute(
        "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?", (f'"{tokens[0]}"',)
    ).fetchall()
    if first[0] not in {row[0] for row in matches}:
        raise CorpusValidationError(f"{path}: FTS5 index failed a known-token search")


def _validate_vectors(connection: sqlite3.Connection, path: Path, dimensions: int) -> None:
    schema = connection.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'chunk_vectors'"
    ).fetchone()
    if (
        schema is None
        or f"float[{dimensions}]" not in schema[0]
        or "distance_metric=cosine" not in schema[0]
    ):
        raise CorpusValidationError(f"{path}: vector index compatibility does not match metadata")
    first = connection.execute(
        "SELECT chunk_rowid, embedding FROM chunk_vectors ORDER BY chunk_rowid LIMIT 1"
    ).fetchone()
    if first is None:
        raise CorpusValidationError(f"{path}: vector index is empty")
    nearest = connection.execute(
        "SELECT chunk_rowid FROM chunk_vectors WHERE embedding MATCH ? AND k = 1",
        (first[1],),
    ).fetchone()
    if nearest != (first[0],):
        raise CorpusValidationError(f"{path}: vector index failed a self-nearest-neighbor query")


def _check_runtime(spec: ArtifactSpec) -> None:
    if sqlite3.sqlite_version != spec.sqlite_version:
        raise RuntimeError(
            f"SQLite runtime mismatch: expected {spec.sqlite_version}, got {sqlite3.sqlite_version}"
        )
    connection = sqlite3.connect(":memory:")
    try:
        _load_vec(connection)
        actual = str(connection.execute("SELECT vec_version()").fetchone()[0]).removeprefix("v")
    finally:
        connection.close()
    if actual != spec.sqlite_vec_version:
        raise RuntimeError(
            f"sqlite-vec runtime mismatch: expected {spec.sqlite_vec_version}, got {actual}"
        )


def _connect(path: Path, *, readonly: bool) -> sqlite3.Connection:
    if readonly:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    else:
        connection = sqlite3.connect(path)
    _load_vec(connection)
    return connection


def _load_vec(connection: sqlite3.Connection) -> None:
    connection.enable_load_extension(True)
    try:
        sqlite_vec.load(connection)
    finally:
        connection.enable_load_extension(False)


def _single_int(connection: sqlite3.Connection, query: str) -> int:
    row = connection.execute(query).fetchone()
    if row is None:
        raise CorpusValidationError(f"Query returned no count: {query}")
    return int(row[0])
