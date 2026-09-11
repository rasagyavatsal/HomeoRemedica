from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from collections.abc import Sequence
from pathlib import Path

import sqlite_vec

from chat.chat import BookSummary, RetrievedSource
from corpus.contracts import ActivePointer, Compatibility, PublishedBook, ReleaseManifest


class CorpusError(RuntimeError):
    """The local corpus is missing, corrupt, or incompatible."""


MAX_MANIFEST_BYTES = 1 * 1024 * 1024
MAX_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024
MAX_TOTAL_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024
MAX_SOURCE_TEXT_CHARS = 8_000
MAX_SOURCE_LABEL_CHARS = 256
MAX_BOOK_COUNT = 16
EXPECTED_BOOK_IDS = frozenset({
    "allen-nosodes",
    "boericke-MM",
    "clarke-MM",
    "kent-lectures",
})
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
        if sum(book.byte_size for book in manifest.books) > MAX_TOTAL_ARTIFACT_BYTES:
            raise CorpusError("corpus artifacts exceed the total size limit")

        _validate_release_artifacts(root, release_directory, manifest)
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
    """Search one already-verified immutable release across its indexed books."""

    def __init__(self, directory: Path, manifest: ReleaseManifest) -> None:
        self._directory = directory
        self._manifest = manifest
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
        rankings: list[tuple[str, ...]] = []
        details: dict[str, RetrievedSource] = {}

        for book in self._manifest.books:
            if book.book_id not in selected:
                continue
            path = self._directory / book.filename
            connection = _connect(path)
            try:
                lexical = _lexical_ranking(connection, lexical_query, candidate_limit)
                semantic = _semantic_ranking(connection, serialized_embedding, candidate_limit)
                rankings.extend(
                    tuple(f"{book.book_id}/{chunk_id}" for chunk_id in ranking)
                    for ranking in (lexical, semantic)
                    if ranking
                )
                candidate_ids = set(lexical).union(semantic)
                details.update(_source_details(connection, book, candidate_ids))
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


def _validate_release_artifacts(
    root: Path, release_directory: Path, manifest: ReleaseManifest
) -> None:
    compatibility = manifest.compatibility
    for book in manifest.books:
        path = _safe_child(root, f"{manifest.corpus_version}/{book.filename}", book.book_id)
        if not path.is_file():
            raise CorpusError(f"local corpus artifact is missing: {book.book_id}")
        if path.stat().st_size != book.byte_size or _sha256_file(path) != book.sha256:
            raise CorpusError(f"local corpus artifact is missing or corrupt: {book.book_id}")
        _validate_artifact(path, manifest, book, compatibility)


def _validate_artifact(
    path: Path,
    manifest: ReleaseManifest,
    book: PublishedBook,
    compatibility: Compatibility,
) -> None:
    connection = _connect(path)
    try:
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        if quick_check is None or quick_check[0] != "ok":
            raise CorpusError(f"SQLite integrity check failed: {book.book_id}")
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            )
        }
        if not {"metadata", "chunks", "chunks_fts", "chunk_vectors"}.issubset(tables):
            raise CorpusError(f"artifact schema is incomplete: {book.book_id}")
        runtime_vec_version = str(
            connection.execute("SELECT vec_version()").fetchone()[0]
        ).removeprefix("v")
        if (
            sqlite3.sqlite_version != compatibility.sqlite_version
            or runtime_vec_version != compatibility.sqlite_vec_version
        ):
            raise CorpusError(f"artifact runtime is incompatible: {book.book_id}")
        oversized = connection.execute(
            """
            SELECT id FROM chunks
            WHERE length(text) > ? OR length(remedy_name) > ? OR length(section_title) > ?
            LIMIT 1
            """,
            (MAX_SOURCE_TEXT_CHARS, MAX_SOURCE_LABEL_CHARS, MAX_SOURCE_LABEL_CHARS),
        ).fetchone()
        if oversized is not None:
            raise CorpusError(f"corpus source text or label is too large: {book.book_id}")
        metadata = dict(connection.execute("SELECT key, value FROM metadata"))
        chunk_count = int(connection.execute("SELECT count(*) FROM chunks").fetchone()[0])
        vector_count = int(
            connection.execute("SELECT count(*) FROM chunk_vectors").fetchone()[0]
        )
        if (chunk_count, vector_count) != (book.chunk_count, book.chunk_count):
            raise CorpusError(f"artifact index counts are inconsistent: {book.book_id}")
        fts_count = int(connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0])
        if fts_count != book.chunk_count:
            raise CorpusError(f"artifact FTS index count is inconsistent: {book.book_id}")
        vector_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'chunk_vectors'"
        ).fetchone()
        if (
            vector_schema is None
            or f"float[{compatibility.embedding_dimensions}]" not in str(vector_schema[0])
            or "distance_metric=cosine" not in str(vector_schema[0])
        ):
            raise CorpusError(f"artifact vector dimensions are incompatible: {book.book_id}")
        first = connection.execute(
            "SELECT rowid, text FROM chunks ORDER BY rowid LIMIT 1"
        ).fetchone()
        if first is None:
            raise CorpusError(f"artifact contains no chunks: {book.book_id}")
        tokens = re.findall(r"\w+", str(first[1]), flags=re.UNICODE)
        if not tokens:
            raise CorpusError(f"artifact contains no searchable text: {book.book_id}")
        fts_match = connection.execute(
            "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?",
            (f'"{tokens[0]}"',),
        ).fetchall()
        if int(first[0]) not in {int(row[0]) for row in fts_match}:
            raise CorpusError(f"artifact FTS index is invalid: {book.book_id}")
        first_vector = connection.execute(
            "SELECT chunk_rowid, embedding FROM chunk_vectors ORDER BY chunk_rowid LIMIT 1"
        ).fetchone()
        if first_vector is None:
            raise CorpusError(f"artifact vector index is empty: {book.book_id}")
        nearest = connection.execute(
            "SELECT chunk_rowid FROM chunk_vectors WHERE embedding MATCH ? AND k = 1",
            (first_vector[1],),
        ).fetchone()
        if nearest != (first_vector[0],):
            raise CorpusError(f"artifact vector index is invalid: {book.book_id}")
        expected = {
            "artifact_schema_version": str(manifest.artifact_schema_version),
            "book_author": book.author or "",
            "book_id": book.book_id,
            "book_title": book.title,
            "chunk_count": str(book.chunk_count),
            "corpus_hash": manifest.corpus_hash,
            "corpus_version": manifest.corpus_version,
            "distance_function": compatibility.distance_function,
            "document_task_type": compatibility.document_task_type,
            "embedding_dimensions": str(compatibility.embedding_dimensions),
            "embedding_model": compatibility.embedding_model,
            "embedding_normalization": compatibility.embedding_normalization,
            "fts_tokenizer": "porter unicode61 remove_diacritics 2",
            "model_input_limit": str(compatibility.model_input_limit),
            "passage_count": str(book.passage_count),
            "query_task_type": compatibility.query_task_type,
            "source_sha256": book.source_sha256,
            "sqlite_vec_version": compatibility.sqlite_vec_version,
            "sqlite_version": compatibility.sqlite_version,
        }
        mismatched = sorted(key for key, value in expected.items() if metadata.get(key) != value)
        if mismatched:
            raise CorpusError(
                f"artifact metadata is incompatible ({book.book_id}: {', '.join(mismatched)})"
            )
    except sqlite3.Error as error:
        raise CorpusError(f"could not validate corpus artifact {book.book_id}: {error}") from error
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


def _lexical_ranking(connection: sqlite3.Connection, query: str, limit: int) -> tuple[str, ...]:
    if not query:
        return ()
    rows = connection.execute(
        """
        SELECT chunks.id
        FROM chunks_fts
        JOIN chunks ON chunks.rowid = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY bm25(chunks_fts, 3.0, 2.0, 1.0), chunks.id
        LIMIT ?
        """,
        (query, limit),
    )
    return tuple(str(row[0]) for row in rows)


def _semantic_ranking(
    connection: sqlite3.Connection, embedding: bytes, limit: int
) -> tuple[str, ...]:
    count = int(connection.execute("SELECT count(*) FROM chunks").fetchone()[0])
    rows = connection.execute(
        """
        SELECT chunks.id
        FROM chunk_vectors
        JOIN chunks ON chunks.rowid = chunk_vectors.chunk_rowid
        WHERE chunk_vectors.embedding MATCH ? AND k = ?
        ORDER BY chunk_vectors.distance, chunks.id
        """,
        (embedding, min(limit, count)),
    )
    return tuple(str(row[0]) for row in rows)


def _source_details(
    connection: sqlite3.Connection,
    book: PublishedBook,
    chunk_ids: set[str],
) -> dict[str, RetrievedSource]:
    if not chunk_ids:
        return {}
    placeholders = ",".join("?" for _ in chunk_ids)
    rows = connection.execute(
        f"""
        SELECT id, remedy_name, section_title, passage_indexes,
               substr(text, 1, ?) AS text
        FROM chunks
        WHERE id IN ({placeholders})
        """,
        (MAX_SOURCE_TEXT_CHARS, *sorted(chunk_ids)),
    )
    return {
        f"{book.book_id}/{row[0]}": RetrievedSource(
            chunk_id=str(row[0]),
            book_id=book.book_id,
            book_title=book.title,
            author=book.author,
            remedy_name=str(row[1]),
            section_title=str(row[2]),
            passage_indexes=tuple(int(index) for index in json.loads(row[3])),
            text=str(row[4]),
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
