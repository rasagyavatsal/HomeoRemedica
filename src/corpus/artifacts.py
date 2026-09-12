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

from corpus.chunking import Chunk
from corpus.embeddings import EmbeddedChunk, EmbeddingSpec
from corpus.sources import Book, CorpusValidationError

FTS5_TOKENIZER = "porter unicode61 remove_diacritics 2"


@dataclass(frozen=True, slots=True)
class ArtifactSpec:
    corpus_version: str
    corpus_hash: str | None
    embedding: EmbeddingSpec
    sqlite_version: str
    sqlite_vec_version: str
    artifact_schema_version: int = 2

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", self.corpus_version):
            raise ValueError("corpus version must be a safe non-empty release identifier")
        if self.corpus_hash is not None and not re.fullmatch(r"[0-9a-f]{64}", self.corpus_hash):
            raise ValueError("corpus hash must be a lowercase SHA-256 digest")
        if self.artifact_schema_version <= 0:
            raise ValueError("artifact schema version must be positive")


@dataclass(frozen=True, slots=True)
class BuiltBook:
    book_id: str
    title: str
    author: str | None
    source_sha256: str
    chunk_count: int
    passage_count: int


@dataclass(frozen=True, slots=True)
class BuiltArtifact:
    """The verified single SQLite database and its per-book inventory."""

    path: Path
    books: tuple[BuiltBook, ...]
    chunk_count: int
    passage_count: int
    byte_size: int
    sha256: str

    @property
    def book_id(self) -> str:
        return self._only_book().book_id

    @property
    def title(self) -> str:
        return self._only_book().title

    @property
    def author(self) -> str | None:
        return self._only_book().author

    @property
    def source_sha256(self) -> str:
        return self._only_book().source_sha256

    def _only_book(self) -> BuiltBook:
        if len(self.books) != 1:
            raise ValueError("a multi-book artifact has no single book identity")
        return self.books[0]


def create_corpus_artifact(
    path: Path,
    books: Iterable[Book],
    embedded_chunks: Iterable[EmbeddedChunk],
    spec: ArtifactSpec,
    *,
    expected_chunks: Iterable[Chunk] | None = None,
) -> BuiltArtifact:
    """Create one immutable SQLite database containing every configured book."""
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite artifact: {path}")
    source_books = tuple(sorted(books, key=lambda book: book.book_id))
    _validate_book_inputs(source_books)
    source_chunks = tuple(expected_chunks) if expected_chunks is not None else None
    _check_runtime(spec)
    if spec.corpus_hash is None:
        raise ValueError("artifact spec requires the complete corpus hash")

    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
    ) as temporary_file:
        temporary_path = Path(temporary_file.name)
    try:
        _write_database(temporary_path, source_books, embedded_chunks, spec)
        validate_corpus_artifact(
            temporary_path,
            spec,
            expected_books=source_books,
            expected_chunks=source_chunks,
        )
        try:
            os.link(temporary_path, path)
        except FileExistsError as error:
            raise FileExistsError(f"Refusing to overwrite artifact: {path}") from error
        return validate_corpus_artifact(
            path,
            spec,
            expected_books=source_books,
            expected_chunks=source_chunks,
        )
    finally:
        temporary_path.unlink(missing_ok=True)


def validate_corpus_artifact(
    path: Path,
    spec: ArtifactSpec,
    *,
    expected_books: Iterable[Book] | None = None,
    expected_chunks: Iterable[Chunk] | None = None,
) -> BuiltArtifact:
    """Validate one corpus database, including book completeness and indexes."""
    _check_runtime(spec)
    if spec.corpus_hash is None:
        raise ValueError("artifact spec requires the complete corpus hash")
    if not path.is_file():
        raise CorpusValidationError(f"Artifact does not exist: {path}")

    books = (
        tuple(sorted(expected_books, key=lambda book: book.book_id))
        if expected_books is not None
        else None
    )
    chunks = tuple(expected_chunks) if expected_chunks is not None else None
    connection = _connect(path, readonly=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise CorpusValidationError(f"{path}: SQLite integrity_check failed: {integrity}")
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise CorpusValidationError(f"{path}: foreign key violations: {foreign_key_errors}")

        required_tables = {"metadata", "books", "chunks", "chunks_fts", "chunk_vectors"}
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
        user_version = connection.execute("PRAGMA user_version").fetchone()
        if user_version != (spec.artifact_schema_version,):
            raise CorpusValidationError(
                f"{path}: unsupported SQLite user version {user_version}; "
                f"expected {spec.artifact_schema_version}"
            )

        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        _validate_metadata(path, metadata, spec, books, chunks)
        stored_books = _validate_stored_books(connection, path, books)
        metadata_book_count = _metadata_int(path, metadata, "book_count")
        metadata_chunk_count = _metadata_int(path, metadata, "chunk_count")
        metadata_passage_count = _metadata_int(path, metadata, "passage_count")
        if metadata_book_count != len(stored_books):
            raise CorpusValidationError(f"{path}: metadata book count does not match books table")
        chunk_count = _single_int(connection, "SELECT count(*) FROM chunks")
        fts_count = _single_int(connection, "SELECT count(*) FROM chunks_fts")
        vector_count = _single_int(connection, "SELECT count(*) FROM chunk_vectors")
        if (chunk_count, fts_count, vector_count) != (metadata_chunk_count,) * 3:
            raise CorpusValidationError(
                f"{path}: inconsistent chunk/index counts "
                f"(chunks={chunk_count}, fts={fts_count}, vectors={vector_count}, "
                f"expected={metadata_chunk_count})"
            )
        per_book_counts = _validate_stored_chunks(connection, path, chunks)
        stored_counts = {
            book.book_id: (book.chunk_count, book.passage_count) for book in stored_books
        }
        if per_book_counts != stored_counts:
            raise CorpusValidationError(f"{path}: stored book counts differ from chunks")
        if (
            sum(passage_count for _, passage_count in per_book_counts.values())
            != metadata_passage_count
        ):
            raise CorpusValidationError(f"{path}: metadata passage count does not match chunks")
        _validate_fts(connection, path)
        _validate_vectors(connection, path, spec.embedding.dimensions)
    except sqlite3.DatabaseError as error:
        raise CorpusValidationError(f"{path}: invalid SQLite artifact: {error}") from error
    finally:
        connection.close()

    return BuiltArtifact(
        path=path,
        books=stored_books,
        chunk_count=metadata_chunk_count,
        passage_count=metadata_passage_count,
        byte_size=path.stat().st_size,
        sha256=sha256_file(path),
    )


def create_book_artifact(
    path: Path,
    book: Book,
    embedded_chunks: Iterable[EmbeddedChunk],
    spec: ArtifactSpec,
) -> BuiltArtifact:
    """Compatibility wrapper for callers that build a one-book database."""
    return create_corpus_artifact(path, (book,), embedded_chunks, spec)


def validate_book_artifact(
    path: Path,
    spec: ArtifactSpec,
    *,
    expected_book: Book | None = None,
    expected_chunks: Iterable[Chunk] | None = None,
) -> BuiltArtifact:
    """Compatibility wrapper for validating a database containing one book."""
    expected_books = (expected_book,) if expected_book is not None else None
    artifact = validate_corpus_artifact(
        path,
        spec,
        expected_books=expected_books,
        expected_chunks=expected_chunks,
    )
    if len(artifact.books) != 1:
        raise CorpusValidationError(f"{path}: expected an artifact containing exactly one book")
    return artifact


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for block in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _validate_book_inputs(books: tuple[Book, ...]) -> None:
    if not books:
        raise ValueError("cannot build an empty corpus artifact")
    book_ids = {book.book_id for book in books}
    if len(book_ids) != len(books):
        raise ValueError("corpus artifact contains duplicate book IDs")


def _write_database(
    path: Path,
    books: tuple[Book, ...],
    embedded_chunks: Iterable[EmbeddedChunk],
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

            CREATE TABLE books (
                book_id TEXT PRIMARY KEY,
                title TEXT NOT NULL CHECK(length(title) > 0),
                author TEXT,
                source_sha256 TEXT NOT NULL,
                chunk_count INTEGER NOT NULL CHECK(chunk_count > 0),
                passage_count INTEGER NOT NULL CHECK(passage_count > 0)
            ) WITHOUT ROWID;

            CREATE TABLE chunks (
                rowid INTEGER PRIMARY KEY,
                id TEXT NOT NULL UNIQUE,
                book_id TEXT NOT NULL REFERENCES books(book_id),
                remedy_slug TEXT NOT NULL,
                remedy_name TEXT NOT NULL,
                section_slug TEXT NOT NULL,
                section_title TEXT NOT NULL,
                passage_indexes TEXT NOT NULL CHECK(json_valid(passage_indexes)),
                part INTEGER NOT NULL CHECK(part > 0),
                text TEXT NOT NULL CHECK(length(text) > 0)
            );

            CREATE INDEX chunks_book_id ON chunks(book_id, rowid);
            CREATE INDEX chunks_remedy_section
                ON chunks(book_id, remedy_slug, section_slug, part);

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
                book_id TEXT partition key,
                embedding float[{spec.embedding.dimensions}] distance_metric=cosine
            );
            """
        )

        connection.executemany(
            """
            INSERT INTO books(book_id, title, author, source_sha256, chunk_count, passage_count)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                (book.book_id, book.title, book.author, book.source_sha256, 1, 1)
                for book in books
            ),
        )

        book_counts = {book.book_id: [0, 0] for book in books}
        seen_chunk_ids: set[str] = set()
        chunk_count = 0
        passage_count = 0
        for rowid, item in enumerate(embedded_chunks, start=1):
            chunk = item.chunk
            if chunk.book_id not in book_counts:
                raise CorpusValidationError(
                    f"{chunk.book_id}: artifact received a chunk from an unknown book"
                )
            if chunk.id in seen_chunk_ids:
                raise CorpusValidationError(
                    f"corpus artifact contains duplicate chunk ID: {chunk.id}"
                )
            seen_chunk_ids.add(chunk.id)
            if len(item.embedding) != spec.embedding.dimensions:
                raise CorpusValidationError(
                    f"{chunk.book_id} / {chunk.id}: expected {spec.embedding.dimensions} "
                    f"embedding dimensions, got {len(item.embedding)}"
                )
            norm = math.sqrt(math.fsum(value * value for value in item.embedding))
            if not math.isclose(norm, 1.0, rel_tol=1e-5, abs_tol=1e-5):
                raise CorpusValidationError(
                    f"{chunk.book_id} / {chunk.id}: embedding is not L2 normalized"
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
                "INSERT INTO chunk_vectors(chunk_rowid, book_id, embedding) VALUES (?, ?, ?)",
                (rowid, chunk.book_id, sqlite_vec.serialize_float32(list(item.embedding))),
            )
            book_counts[chunk.book_id][0] += 1
            book_counts[chunk.book_id][1] += len(chunk.passage_indexes)
            chunk_count += 1
            passage_count += len(chunk.passage_indexes)

        if not chunk_count:
            raise CorpusValidationError("cannot build an artifact with no chunks")
        missing = sorted(book_id for book_id, counts in book_counts.items() if counts[0] == 0)
        if missing:
            raise CorpusValidationError(
                f"corpus artifact has no chunks for configured book(s): {', '.join(missing)}"
            )
        connection.executemany(
            "UPDATE books SET chunk_count = ?, passage_count = ? WHERE book_id = ?",
            ((counts[0], counts[1], book_id) for book_id, counts in book_counts.items()),
        )

        connection.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
        metadata = _metadata(
            books,
            chunk_count=chunk_count,
            passage_count=passage_count,
            spec=spec,
        )
        connection.executemany(
            "INSERT INTO metadata(key, value) VALUES (?, ?)", sorted(metadata.items())
        )
        connection.commit()
        connection.execute("PRAGMA optimize")
        connection.execute("VACUUM")
    finally:
        connection.close()


def _metadata(
    books: tuple[Book, ...], chunk_count: int, passage_count: int, spec: ArtifactSpec
) -> dict[str, str]:
    return {
        "artifact_schema_version": str(spec.artifact_schema_version),
        "book_count": str(len(books)),
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
        "sqlite_vec_version": spec.sqlite_vec_version,
        "sqlite_version": spec.sqlite_version,
    }


def _validate_metadata(
    path: Path,
    actual: dict[str, str],
    spec: ArtifactSpec,
    books: tuple[Book, ...] | None,
    chunks: tuple[Chunk, ...] | None,
) -> None:
    expected = {
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
    if books is not None:
        expected["book_count"] = str(len(books))
    if chunks is not None:
        expected.update(
            {
                "chunk_count": str(len(chunks)),
                "passage_count": str(sum(len(chunk.passage_indexes) for chunk in chunks)),
            }
        )
    required = {
        "artifact_schema_version",
        "book_count",
        "chunk_count",
        "corpus_hash",
        "corpus_version",
        "distance_function",
        "document_task_type",
        "embedding_dimensions",
        "embedding_model",
        "embedding_normalization",
        "fts_tokenizer",
        "model_input_limit",
        "passage_count",
        "query_task_type",
        "sqlite_vec_version",
        "sqlite_version",
    }
    missing = sorted(required - set(actual))
    mismatched = sorted(key for key, value in expected.items() if actual.get(key) != value)
    if missing or mismatched:
        raise CorpusValidationError(
            f"{path}: invalid artifact metadata (missing={missing}, mismatched={mismatched})"
        )


def _validate_stored_books(
    connection: sqlite3.Connection, path: Path, expected: tuple[Book, ...] | None
) -> tuple[BuiltBook, ...]:
    rows = connection.execute(
        """
        SELECT book_id, title, author, source_sha256, chunk_count, passage_count
        FROM books ORDER BY book_id
        """
    ).fetchall()
    if not rows:
        raise CorpusValidationError(f"{path}: corpus contains no books")
    for row in rows:
        if (
            not isinstance(row[0], str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", row[0])
            or not isinstance(row[1], str)
            or not row[1]
            or (row[2] is not None and not isinstance(row[2], str))
            or type(row[4]) is not int
            or row[4] <= 0
            or type(row[5]) is not int
            or row[5] <= 0
            or not isinstance(row[3], str)
            or not re.fullmatch(r"[0-9a-f]{64}", row[3])
        ):
            raise CorpusValidationError(f"{path}: invalid stored book metadata for {row[0]!r}")
    if expected is not None:
        actual_identity = tuple(row[:4] for row in rows)
        expected_identity = tuple(
            (book.book_id, book.title, book.author, book.source_sha256) for book in expected
        )
        if actual_identity != expected_identity:
            raise CorpusValidationError(f"{path}: stored books differ from validated source books")
    return tuple(
        BuiltBook(
            book_id=str(row[0]),
            title=str(row[1]),
            author=str(row[2]) if row[2] is not None else None,
            source_sha256=str(row[3]),
            chunk_count=int(row[4]),
            passage_count=int(row[5]),
        )
        for row in rows
    )


def _validate_stored_chunks(
    connection: sqlite3.Connection, path: Path, expected: tuple[Chunk, ...] | None
) -> dict[str, tuple[int, int]]:
    rows = connection.execute(
        """
        SELECT id, book_id, remedy_slug, remedy_name, section_slug, section_title,
               passage_indexes, part, text
        FROM chunks ORDER BY rowid
        """
    ).fetchall()
    for row in rows:
        try:
            indexes = json.loads(row[6])
        except (TypeError, json.JSONDecodeError) as error:
            raise CorpusValidationError(
                f"{path}: invalid stored passage indexes for {row[0]}"
            ) from error
        if (
            not isinstance(indexes, list)
            or not indexes
            or not all(isinstance(index, int) and index >= 0 for index in indexes)
            or indexes != sorted(set(indexes))
        ):
            raise CorpusValidationError(f"{path}: invalid stored passage indexes for {row[0]}")
    actual_counts = {
        str(row[0]): (int(row[1]), int(row[2]))
        for row in connection.execute(
            "SELECT book_id, count(*), sum(json_array_length(passage_indexes)) "
            "FROM chunks GROUP BY book_id"
        )
    }
    if expected is None:
        return actual_counts
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
    expected_counts = {
        book_id: (
            sum(chunk.book_id == book_id for chunk in expected),
            sum(len(chunk.passage_indexes) for chunk in expected if chunk.book_id == book_id),
        )
        for book_id in {chunk.book_id for chunk in expected}
    }
    if actual_counts != expected_counts:
        raise CorpusValidationError(f"{path}: stored per-book chunk counts differ from source")
    return actual_counts


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
        or "book_id TEXT partition key" not in schema[0]
    ):
        raise CorpusValidationError(f"{path}: vector index compatibility does not match metadata")
    vector_book_mismatch = connection.execute(
        """
        SELECT 1
        FROM chunk_vectors AS vectors
        LEFT JOIN chunks ON chunks.rowid = vectors.chunk_rowid
        WHERE chunks.rowid IS NULL
           OR vectors.book_id IS NULL
           OR vectors.book_id <> chunks.book_id
        LIMIT 1
        """
    ).fetchone()
    if vector_book_mismatch is not None:
        raise CorpusValidationError(f"{path}: vector book partitions do not match chunks")
    first = connection.execute(
        "SELECT chunk_rowid, book_id, embedding FROM chunk_vectors ORDER BY chunk_rowid LIMIT 1"
    ).fetchone()
    if first is None:
        raise CorpusValidationError(f"{path}: vector index is empty")
    first_book_count = connection.execute(
        "SELECT count(*) FROM chunk_vectors WHERE book_id = ?", (first[1],)
    ).fetchone()
    if first_book_count is None or not first_book_count[0]:
        raise CorpusValidationError(f"{path}: first vector book partition is empty")
    nearest = connection.execute(
        """
        SELECT chunk_rowid
        FROM chunk_vectors
        WHERE embedding MATCH ? AND book_id = ? AND k = ?
        """,
        (first[2], first[1], min(10, int(first_book_count[0]))),
    ).fetchall()
    if first[0] not in {row[0] for row in nearest}:
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


def _metadata_int(path: Path, metadata: dict[str, str], key: str) -> int:
    try:
        value = int(metadata[key])
    except (KeyError, TypeError, ValueError) as error:
        raise CorpusValidationError(f"{path}: metadata {key} must be an integer") from error
    if value <= 0:
        raise CorpusValidationError(f"{path}: metadata {key} must be positive")
    return value
