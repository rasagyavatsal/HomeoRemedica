from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from collections.abc import Sequence
from pathlib import Path

import sqlite_vec

from corpus.contracts import ActivePointer, ReleaseManifest
from shared.contracts import BookSummary, RetrievedSource


class CorpusError(RuntimeError):
    """The local corpus is missing, corrupt, or incompatible."""


MAX_MANIFEST_BYTES = 1 * 1024 * 1024
MAX_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024
MAX_SOURCE_TEXT_CHARS = 8_000
MAX_SOURCE_LABEL_CHARS = 256
MAX_BOOK_COUNT = 16
MAX_VECTOR_K = 4096
EXPECTED_BOOK_IDS = frozenset(
    {
        "allen-nosodes",
        "boericke-MM",
        "clarke-MM",
        "kent-lectures",
    }
)
_SAFE_PATH_COMPONENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


def _require_safe_path_component(value: str, label: str) -> None:
    if not _SAFE_PATH_COMPONENT.fullmatch(value):
        raise ValueError(f"{label} must be a safe path component")


class LocalCorpus:
    """Load and verify the active release from a local corpus directory."""

    def __init__(
        self,
        directory: Path,
        *,
        expected_book_ids: frozenset[str] = EXPECTED_BOOK_IDS,
    ) -> None:
        self._directory = directory.expanduser()
        self._expected_book_ids = expected_book_ids

    def load(self) -> CorpusRelease:
        root = self._directory
        if root.is_symlink():
            raise CorpusError(f"corpus directory must not be a symbolic link: {root}")
        if not root.is_dir():
            raise CorpusError(f"corpus directory does not exist: {root}")

        pointer_path = root / "active.json"
        pointer_bytes = _read_bounded(pointer_path, MAX_MANIFEST_BYTES, "active pointer")
        try:
            pointer = ActivePointer.model_validate_json(pointer_bytes)
        except ValueError as error:
            raise CorpusError(f"invalid active corpus pointer: {error}") from error

        release_directory = _safe_child(root, pointer.corpus_version, "active release")
        expected_manifest_path = release_directory / "manifest.json"
        manifest_path = _safe_child(root, pointer.manifest_path, "manifest")
        if manifest_path != expected_manifest_path:
            raise CorpusError("active pointer contains an unexpected manifest path")
        manifest_bytes = _read_bounded(manifest_path, pointer.manifest_byte_size, "manifest")
        _verify_object(
            manifest_bytes,
            byte_size=pointer.manifest_byte_size,
            sha256=pointer.manifest_sha256,
            label="manifest",
        )
        try:
            manifest = ReleaseManifest.model_validate_json(manifest_bytes)
        except ValueError as error:
            raise CorpusError(f"invalid corpus manifest: {error}") from error
        if (
            pointer.corpus_version != manifest.corpus_version
            or manifest_path != root / manifest.corpus_version / "manifest.json"
        ):
            raise CorpusError("active pointer and release manifest identities do not match")

        book_ids = {book.book_id for book in manifest.books}
        if book_ids != self._expected_book_ids:
            missing = sorted(self._expected_book_ids - book_ids)
            unsupported = sorted(book_ids - self._expected_book_ids)
            details = []
            if missing:
                details.append(f"missing: {', '.join(missing)}")
            if unsupported:
                details.append(f"unsupported: {', '.join(unsupported)}")
            raise CorpusError(
                "corpus must contain the exact expected book set " + "; ".join(details)
            )
        if manifest.artifact.byte_size > MAX_ARTIFACT_BYTES:
            raise CorpusError("corpus artifact exceeds the size limit")

        _validate_release_artifact(root, release_directory, manifest)
        return CorpusRelease(release_directory, manifest)


class CorpusCache(LocalCorpus):
    """Compatibility name for the local verified corpus loader."""

    def open_cached(self) -> CorpusRelease:
        return self.load()


def load_local_corpus(
    directory: Path,
    *,
    expected_book_ids: frozenset[str] = EXPECTED_BOOK_IDS,
) -> CorpusRelease:
    return LocalCorpus(directory, expected_book_ids=expected_book_ids).load()


class CorpusRelease:
    """Search one already-verified release through its shared corpus database."""

    def __init__(self, directory: Path, manifest: ReleaseManifest) -> None:
        self._directory = directory
        self._manifest = manifest
        self._artifact_path = directory / manifest.artifact.filename
        self.corpus_version = manifest.corpus_version

    @property
    def model_input_limit(self) -> int:
        return self._manifest.compatibility.model_input_limit

    @property
    def embedding_model(self) -> str:
        return self._manifest.compatibility.embedding_model

    @property
    def embedding_dimensions(self) -> int:
        return self._manifest.compatibility.embedding_dimensions

    @property
    def query_task_type(self) -> str:
        return self._manifest.compatibility.query_task_type

    @property
    def book_ids(self) -> tuple[str, ...]:
        return tuple(book.book_id for book in self._manifest.books)

    @property
    def books(self) -> tuple[BookSummary, ...]:
        return tuple(
            BookSummary(book_id=book.book_id, title=book.title, author=book.author)
            for book in self._manifest.books
        )

    def search(
        self,
        query: str,
        embedding: tuple[float, ...],
        *,
        book_ids: tuple[str, ...] | None,
        limit: int,
    ) -> tuple[RetrievedSource, ...]:
        if limit <= 0:
            raise ValueError("source limit must be positive")
        selected = set(book_ids or self.book_ids)
        unknown = selected.difference(self.book_ids)
        if unknown:
            raise ValueError(f"unknown book IDs: {', '.join(sorted(unknown))}")
        dimensions = self.embedding_dimensions
        serialized_embedding = _serialize_normalized(embedding, dimensions)
        lexical_query = _fts_or_query(query)
        candidate_limit = max(25, limit)

        connection = _connect(self._artifact_path)
        try:
            lexical = _lexical_ranking(connection, lexical_query, selected, candidate_limit)
            semantic = _semantic_ranking(
                connection, serialized_embedding, selected, candidate_limit
            )
            rankings = [ranking for ranking in (lexical, semantic) if ranking]
            candidate_ids = set(lexical).union(semantic)
            details = _source_details(connection, candidate_ids)
        finally:
            connection.close()

        scores, best_ranks = _reciprocal_rank_scores(rankings, rank_constant=60)
        ordered = sorted(scores, key=lambda key: (-scores[key], best_ranks[key], key))[:limit]
        return tuple(
            RetrievedSource(
                chunk_id=details[key].chunk_id,
                book_id=details[key].book_id,
                book_title=details[key].book_title,
                author=details[key].author,
                remedy_name=details[key].remedy_name,
                section_title=details[key].section_title,
                passage_indexes=details[key].passage_indexes,
                text=details[key].text,
                score=scores[key],
            )
            for key in ordered
        )


def _validate_release_artifact(
    root: Path, release_directory: Path, manifest: ReleaseManifest
) -> None:
    artifact = manifest.artifact
    path = _safe_child(
        root,
        f"{manifest.corpus_version}/{artifact.filename}",
        "corpus artifact",
    )
    if not path.is_file():
        raise CorpusError("local corpus artifact is missing")
    if path.stat().st_size != artifact.byte_size or _sha256_file(path) != artifact.sha256:
        raise CorpusError("local corpus artifact is missing or corrupt")
    _validate_artifact(path, manifest)


def _validate_artifact(path: Path, manifest: ReleaseManifest) -> None:
    compatibility = manifest.compatibility
    connection = _connect(path)
    try:
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        if quick_check is None or quick_check[0] != "ok":
            raise CorpusError("SQLite integrity check failed")
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_errors:
            raise CorpusError("SQLite foreign key check failed")
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            )
        }
        if not {"metadata", "books", "chunks", "chunks_fts", "chunk_vectors"}.issubset(tables):
            raise CorpusError("corpus artifact schema is incomplete")
        user_version = connection.execute("PRAGMA user_version").fetchone()
        if user_version != (manifest.artifact_schema_version,):
            raise CorpusError("corpus artifact schema version is incompatible")
        runtime_vec_version = str(
            connection.execute("SELECT vec_version()").fetchone()[0]
        ).removeprefix("v")
        if (
            sqlite3.sqlite_version != compatibility.sqlite_version
            or runtime_vec_version != compatibility.sqlite_vec_version
        ):
            raise CorpusError("corpus artifact runtime is incompatible")

        oversized = connection.execute(
            """
            SELECT id FROM chunks
            WHERE length(text) > ? OR length(remedy_name) > ? OR length(section_title) > ?
            LIMIT 1
            """,
            (MAX_SOURCE_TEXT_CHARS, MAX_SOURCE_LABEL_CHARS, MAX_SOURCE_LABEL_CHARS),
        ).fetchone()
        if oversized is not None:
            raise CorpusError("corpus source text or label is too large")

        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        expected_metadata = {
            "artifact_schema_version": str(manifest.artifact_schema_version),
            "book_count": str(manifest.artifact.book_count),
            "chunk_count": str(manifest.artifact.chunk_count),
            "corpus_hash": manifest.corpus_hash,
            "corpus_version": manifest.corpus_version,
            "distance_function": compatibility.distance_function,
            "document_task_type": compatibility.document_task_type,
            "embedding_dimensions": str(compatibility.embedding_dimensions),
            "embedding_model": compatibility.embedding_model,
            "embedding_normalization": compatibility.embedding_normalization,
            "fts_tokenizer": "porter unicode61 remove_diacritics 2",
            "model_input_limit": str(compatibility.model_input_limit),
            "passage_count": str(manifest.artifact.passage_count),
            "query_task_type": compatibility.query_task_type,
            "sqlite_vec_version": compatibility.sqlite_vec_version,
            "sqlite_version": compatibility.sqlite_version,
        }
        mismatched = sorted(
            key for key, value in expected_metadata.items() if metadata.get(key) != value
        )
        if mismatched:
            raise CorpusError(f"corpus metadata is incompatible: {', '.join(mismatched)}")

        actual_books = tuple(
            connection.execute(
                """
                SELECT book_id, title, author, source_sha256, chunk_count, passage_count
                FROM books ORDER BY book_id
                """
            ).fetchall()
        )
        expected_books = tuple(
            (
                book.book_id,
                book.title,
                book.author,
                book.source_sha256,
                book.chunk_count,
                book.passage_count,
            )
            for book in manifest.books
        )
        if actual_books != expected_books:
            raise CorpusError("corpus book metadata is incomplete or incompatible")

        chunk_count = int(connection.execute("SELECT count(*) FROM chunks").fetchone()[0])
        vector_count = int(
            connection.execute("SELECT count(*) FROM chunk_vectors").fetchone()[0]
        )
        fts_count = int(connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0])
        book_count = int(connection.execute("SELECT count(*) FROM books").fetchone()[0])
        if (book_count, chunk_count, vector_count, fts_count) != (
            manifest.artifact.book_count,
            manifest.artifact.chunk_count,
            manifest.artifact.chunk_count,
            manifest.artifact.chunk_count,
        ):
            raise CorpusError("corpus index counts are inconsistent")
        per_book = {
            str(row[0]): (int(row[1]), int(row[2]))
            for row in connection.execute(
                "SELECT book_id, count(*), sum(json_array_length(passage_indexes)) "
                "FROM chunks GROUP BY book_id"
            )
        }
        expected_per_book = {
            book.book_id: (book.chunk_count, book.passage_count) for book in manifest.books
        }
        if per_book != expected_per_book:
            raise CorpusError("corpus per-book counts are inconsistent")

        vector_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'chunk_vectors'"
        ).fetchone()
        if (
            vector_schema is None
            or f"float[{compatibility.embedding_dimensions}]" not in str(vector_schema[0])
            or "distance_metric=cosine" not in str(vector_schema[0])
            or "book_id TEXT partition key" not in str(vector_schema[0])
        ):
            raise CorpusError("corpus vector dimensions are incompatible")
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
            raise CorpusError("corpus vector book partitions are invalid")
        vector_per_book = {
            str(row[0]): int(row[1])
            for row in connection.execute(
                "SELECT book_id, count(*) FROM chunk_vectors GROUP BY book_id"
            )
        }
        expected_vector_per_book = {book.book_id: book.chunk_count for book in manifest.books}
        if vector_per_book != expected_vector_per_book:
            raise CorpusError("corpus vector book partitions are incomplete")
        first = connection.execute(
            "SELECT rowid, text FROM chunks ORDER BY rowid LIMIT 1"
        ).fetchone()
        if first is None:
            raise CorpusError("corpus contains no chunks")
        tokens = re.findall(r"\w+", str(first[1]), flags=re.UNICODE)
        if not tokens:
            raise CorpusError("corpus contains no searchable text")
        fts_match = connection.execute(
            "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?",
            (f'"{tokens[0]}"',),
        ).fetchall()
        if int(first[0]) not in {int(row[0]) for row in fts_match}:
            raise CorpusError("corpus FTS index is invalid")
        first_vector = connection.execute(
            "SELECT chunk_rowid, book_id, embedding "
            "FROM chunk_vectors ORDER BY chunk_rowid LIMIT 1"
        ).fetchone()
        if first_vector is None:
            raise CorpusError("corpus vector index is empty")
        first_book_count = int(
            connection.execute(
                "SELECT count(*) FROM chunk_vectors WHERE book_id = ?",
                (first_vector[1],),
            ).fetchone()[0]
        )
        nearest = connection.execute(
            """
            SELECT chunk_rowid
            FROM chunk_vectors
            WHERE embedding MATCH ? AND book_id = ? AND k = ?
            """,
            (
                first_vector[2],
                first_vector[1],
                min(10, first_book_count),
            ),
        ).fetchall()
        if int(first_vector[0]) not in {int(row[0]) for row in nearest}:
            raise CorpusError("corpus vector index is invalid")
    except sqlite3.Error as error:
        raise CorpusError(f"could not validate corpus artifact: {error}") from error
    finally:
        connection.close()


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    connection.enable_load_extension(True)
    try:
        sqlite_vec.load(connection)
    finally:
        connection.enable_load_extension(False)
    return connection


def _serialize_normalized(values: Sequence[float], dimensions: int) -> bytes:
    if len(values) != dimensions:
        raise CorpusError(f"expected {dimensions} query embedding dimensions, got {len(values)}")
    norm = math.sqrt(math.fsum(float(value) ** 2 for value in values))
    if norm == 0 or not math.isfinite(norm):
        raise CorpusError("query embedding is zero or non-finite")
    return sqlite_vec.serialize_float32([float(value) / norm for value in values])


MAX_FTS_TOKENS = 128


def _fts_or_query(query: str) -> str:
    tokens = [
        token
        for token in dict.fromkeys(re.findall(r"[^\W_]+", query.casefold(), flags=re.UNICODE))
        if len(token) >= 2
    ][:MAX_FTS_TOKENS]
    return " OR ".join(f'"{token}"' for token in tokens)


def _book_filter(selected: set[str]) -> tuple[str, tuple[str, ...]]:
    if not selected:
        return "1 = 0", ()
    values = tuple(sorted(selected))
    placeholders = ",".join("?" for _ in values)
    return f"chunks.book_id IN ({placeholders})", values


def _lexical_ranking(
    connection: sqlite3.Connection, query: str, selected: set[str], limit: int
) -> tuple[str, ...]:
    if not query:
        return ()
    book_filter, book_parameters = _book_filter(selected)
    rows = connection.execute(
        f"""
        SELECT chunks.id
        FROM chunks_fts
        JOIN chunks ON chunks.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ? AND {book_filter}
        ORDER BY bm25(chunks_fts, 3.0, 2.0, 1.0), chunks.id
        LIMIT ?
        """,
        (query, *book_parameters, limit),
    )
    return tuple(str(row[0]) for row in rows)


def _semantic_ranking(
    connection: sqlite3.Connection,
    embedding: bytes,
    selected: set[str],
    limit: int,
) -> tuple[str, ...]:
    candidates: list[tuple[float, str]] = []
    for book_id in sorted(selected):
        count = int(
            connection.execute(
                "SELECT count(*) FROM chunks WHERE book_id = ?", (book_id,)
            ).fetchone()[0]
        )
        if not count:
            continue
        rows = connection.execute(
            """
            SELECT chunks.id, chunk_vectors.distance
            FROM chunk_vectors
            JOIN chunks ON chunks.rowid = chunk_vectors.chunk_rowid
            WHERE chunk_vectors.embedding MATCH ?
              AND chunk_vectors.book_id = ?
              AND k = ?
            ORDER BY chunk_vectors.distance, chunks.id
            LIMIT ?
            """,
            (embedding, book_id, min(count, limit, MAX_VECTOR_K), limit),
        )
        candidates.extend((float(row[1]), str(row[0])) for row in rows)
    candidates.sort(key=lambda item: (item[0], item[1]))
    return tuple(chunk_id for _, chunk_id in candidates[:limit])


def _source_details(
    connection: sqlite3.Connection,
    chunk_ids: set[str],
) -> dict[str, RetrievedSource]:
    if not chunk_ids:
        return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = connection.execute(
        f"""
        SELECT chunks.id, chunks.book_id, books.title, books.author,
               chunks.remedy_name, chunks.section_title, chunks.passage_indexes,
               substr(chunks.text, 1, ?) AS text
        FROM chunks
        JOIN books ON books.book_id = chunks.book_id
        WHERE chunks.id IN ({placeholders})
        """,
        (MAX_SOURCE_TEXT_CHARS, *sorted(chunk_ids)),
    )
    return {
        str(row[0]): RetrievedSource(
            chunk_id=str(row[0]),
            book_id=str(row[1]),
            book_title=str(row[2]),
            author=str(row[3]) if row[3] is not None else None,
            remedy_name=str(row[4]),
            section_title=str(row[5]),
            passage_indexes=tuple(int(index) for index in json.loads(row[6])),
            text=str(row[7]),
            score=0.0,
        )
        for row in rows
    }


def _reciprocal_rank_scores(
    rankings: Sequence[Sequence[str]], *, rank_constant: int
) -> tuple[dict[str, float], dict[str, int]]:
    scores: dict[str, float] = {}
    best_ranks: dict[str, int] = {}
    for ranking in rankings:
        for rank, key in enumerate(ranking, start=1):
            scores[key] = scores.get(key, 0.0) + 1 / (rank_constant + rank)
            best_ranks[key] = min(rank, best_ranks.get(key, rank))
    return scores, best_ranks


def _safe_child(root: Path, relative: str, label: str) -> Path:
    candidate = root / relative
    try:
        resolved = candidate.resolve(strict=False)
        root_resolved = root.resolve()
        if not resolved.is_relative_to(root_resolved):
            raise CorpusError(f"{label} path escapes the corpus directory")
    except OSError as error:
        raise CorpusError(f"could not resolve {label} path") from error
    if _has_symlink_component(root, candidate):
        raise CorpusError(f"{label} must not be a symbolic link")
    return candidate


def _has_symlink_component(root: Path, candidate: Path) -> bool:
    try:
        relative_parts = candidate.relative_to(root).parts
    except ValueError:
        return True
    current = root
    for part in relative_parts:
        current /= part
        if current.is_symlink():
            return True
    return False


def _read_bounded(path: Path, max_bytes: int, label: str) -> bytes:
    try:
        if path.stat().st_size > max_bytes:
            raise CorpusError(f"{label} exceeds the size limit")
        content = path.read_bytes()
    except CorpusError:
        raise
    except OSError as error:
        raise CorpusError(f"could not read {label}: {path}") from error
    if len(content) > max_bytes:
        raise CorpusError(f"{label} exceeds the size limit")
    return content


def _verify_object(content: bytes, *, byte_size: int, sha256: str, label: str) -> None:
    if len(content) != byte_size or hashlib.sha256(content).hexdigest() != sha256:
        raise CorpusError(f"{label} failed size or SHA-256 verification")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
