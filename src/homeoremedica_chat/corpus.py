from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import sqlite_vec
from google.cloud import storage
from pydantic import Field, model_validator

from homeoremedica_chat.chat import Contract, RetrievedSource


class CorpusError(RuntimeError):
    """The published corpus is missing, corrupt, or incompatible."""


MAX_MANIFEST_BYTES = 1 * 1024 * 1024
# Keep downloads bounded for a local terminal process. The source adapter
# materializes one artifact before validation and SQLite may allocate
# additional pages while opening it.
MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
MAX_TOTAL_ARTIFACT_BYTES = 256 * 1024 * 1024
MAX_SOURCE_TEXT_CHARS = 8_000
MAX_SOURCE_LABEL_CHARS = 256
MAX_BOOK_COUNT = 4
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


def _require_safe_object_name(value: str, label: str) -> None:
    parts = value.split("/")
    if (
        not value
        or value.startswith("/")
        or "\\" in value
        or any(not part or part in {".", ".."} for part in parts)
    ):
        raise ValueError(f"{label} must be a safe relative object name")


class Compatibility(Contract):
    embedding_model: str = Field(min_length=1, max_length=128)
    embedding_dimensions: int = Field(gt=0, le=3072)
    document_task_type: str
    query_task_type: str
    embedding_normalization: str
    distance_function: str
    model_input_limit: int = Field(gt=0, le=100_000)
    sqlite_version: str
    sqlite_vec_version: str


class EvaluationGate(Contract):
    dataset_version: str
    dataset_sha256: str
    corpus_hash: str
    result_sha256: str
    metric: str
    threshold: float = Field(ge=0)
    value: float = Field(ge=0)
    chosen_dimensions: int = Field(gt=0, le=3072)


class PublishedBook(Contract):
    book_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=512)
    author: str | None = Field(default=None, max_length=256)
    object: str = Field(min_length=1, max_length=512)
    generation: int = Field(gt=0)
    byte_size: int = Field(gt=0, le=MAX_ARTIFACT_BYTES)
    sha256: str
    source_sha256: str
    chunk_count: int = Field(gt=0, le=1_000_000)
    passage_count: int = Field(gt=0, le=1_000_000)


class ReleaseManifest(Contract):
    manifest_schema_version: int = 1
    artifact_schema_version: int = 1
    corpus_version: str = Field(min_length=1, max_length=128)
    corpus_hash: str
    compatibility: Compatibility
    evaluation: EvaluationGate
    books: tuple[PublishedBook, ...] = Field(min_length=1, max_length=MAX_BOOK_COUNT)

    @model_validator(mode="after")
    def validate_release(self) -> ReleaseManifest:
        _require_safe_path_component(self.corpus_version, "corpus version")
        for book in self.books:
            _require_safe_path_component(book.book_id, "book ID")
        book_ids = {book.book_id for book in self.books}
        if book_ids != EXPECTED_BOOK_IDS:
            missing = sorted(EXPECTED_BOOK_IDS - book_ids)
            unsupported = sorted(book_ids - EXPECTED_BOOK_IDS)
            details = []
            if missing:
                details.append(f"missing: {', '.join(missing)}")
            if unsupported:
                details.append(f"unsupported: {', '.join(unsupported)}")
            raise ValueError(
                f"corpus must contain the exact expected book set ({'; '.join(details)})"
            )
        if sum(book.byte_size for book in self.books) > MAX_TOTAL_ARTIFACT_BYTES:
            raise ValueError("corpus artifacts exceed the total size limit")
        if self.manifest_schema_version != 1 or self.artifact_schema_version != 1:
            raise ValueError("unsupported corpus schema version")
        if self.evaluation.corpus_hash != self.corpus_hash:
            raise ValueError("evaluation belongs to a different corpus")
        if self.evaluation.chosen_dimensions != self.compatibility.embedding_dimensions:
            raise ValueError("evaluation dimensions do not match the corpus")
        if self.evaluation.value < self.evaluation.threshold:
            raise ValueError("corpus retrieval evaluation did not pass")
        if len({book.book_id for book in self.books}) != len(self.books):
            raise ValueError("corpus contains duplicate book IDs")
        _require_digest(self.corpus_hash, "corpus hash")
        for book in self.books:
            _require_digest(book.sha256, f"{book.book_id} digest")
            _require_digest(book.source_sha256, f"{book.book_id} source digest")
        return self


class ActivePointer(Contract):
    pointer_schema_version: int = 1
    corpus_version: str = Field(min_length=1, max_length=128)
    manifest_object: str = Field(min_length=1, max_length=512)
    manifest_generation: int = Field(gt=0)
    manifest_byte_size: int = Field(gt=0, le=MAX_MANIFEST_BYTES)
    manifest_sha256: str

    @model_validator(mode="after")
    def validate_pointer(self) -> ActivePointer:
        _require_safe_path_component(self.corpus_version, "corpus version")
        _require_safe_object_name(self.manifest_object, "manifest object")
        if self.pointer_schema_version != 1:
            raise ValueError("unsupported active pointer schema version")
        _require_digest(self.manifest_sha256, "manifest digest")
        return self


@dataclass(frozen=True, slots=True)
class ObjectData:
    name: str
    generation: int
    content: bytes


class ObjectSource(Protocol):
    def read(
        self,
        name: str,
        *,
        generation: int | None = None,
        max_bytes: int | None = None,
    ) -> ObjectData: ...


class GoogleCloudCorpusSource:
    """Read immutable corpus object generations without exposing Storage details to callers."""

    def __init__(self, bucket: str, *, project: str = "homeoremedica") -> None:
        self._bucket = storage.Client(project=project).bucket(bucket)

    def read(
        self,
        name: str,
        *,
        generation: int | None = None,
        max_bytes: int | None = None,
    ) -> ObjectData:
        if generation is None:
            current = self._bucket.get_blob(name)
            if current is None or current.generation is None:
                raise CorpusError(f"corpus object does not exist: gs://{self._bucket.name}/{name}")
            generation = int(current.generation)
        blob = self._bucket.blob(name, generation=generation)
        try:
            blob.reload(timeout=10)
            if max_bytes is not None and (blob.size is None or blob.size > max_bytes):
                raise CorpusError(f"corpus object exceeds the size limit: {name}")
            content = blob.download_as_bytes(timeout=120)
        except Exception as error:
            raise CorpusError(
                f"could not read gs://{self._bucket.name}/{name}#{generation}: {error}"
            ) from error
        return ObjectData(name=name, generation=generation, content=content)


class CorpusCache:
    """Atomically materialize and verify one active immutable corpus release."""

    def __init__(self, directory: Path, *, prefix: str = "corpora") -> None:
        self._directory = directory
        self._prefix = prefix.strip("/")
        _require_safe_object_name(self._prefix, "corpus prefix")

    def sync(self, source: ObjectSource) -> CorpusRelease:
        pointer_object = source.read(
            f"{self._prefix}/active.json",
            max_bytes=MAX_MANIFEST_BYTES,
        )
        try:
            pointer = ActivePointer.model_validate_json(pointer_object.content)
        except ValueError as error:
            raise CorpusError(f"invalid active corpus pointer: {error}") from error

        expected_manifest = f"{self._prefix}/{pointer.corpus_version}/manifest.json"
        if pointer.manifest_object != expected_manifest:
            raise CorpusError("active pointer contains an unexpected manifest object path")
        manifest_object = source.read(
            pointer.manifest_object,
            generation=pointer.manifest_generation,
            max_bytes=pointer.manifest_byte_size,
        )
        _verify_object(
            manifest_object.content,
            byte_size=pointer.manifest_byte_size,
            sha256=pointer.manifest_sha256,
            label="manifest",
        )
        try:
            manifest = ReleaseManifest.model_validate_json(manifest_object.content)
        except ValueError as error:
            raise CorpusError(f"invalid corpus manifest: {error}") from error
        expected_manifest = f"{self._prefix}/{manifest.corpus_version}/manifest.json"
        if (
            pointer.corpus_version != manifest.corpus_version
            or pointer.manifest_object != expected_manifest
        ):
            raise CorpusError("active pointer and release manifest identities do not match")

        self._prune_releases(manifest.corpus_version)
        release_directory = self._directory / manifest.corpus_version
        books_directory = release_directory / "books"
        books_directory.mkdir(parents=True, exist_ok=True)
        for book in manifest.books:
            expected_object = (
                f"{self._prefix}/{manifest.corpus_version}/books/{book.book_id}.sqlite"
            )
            if book.object != expected_object:
                raise CorpusError(f"unexpected corpus object path for {book.book_id}")
            destination = books_directory / f"{book.book_id}.sqlite"
            if not _matches_file(destination, book.byte_size, book.sha256):
                artifact = source.read(
                    book.object,
                    generation=book.generation,
                    max_bytes=book.byte_size,
                )
                _verify_object(
                    artifact.content,
                    byte_size=book.byte_size,
                    sha256=book.sha256,
                    label=book.book_id,
                )
                _atomic_write(destination, artifact.content)
            _validate_artifact(destination, manifest, book)

        _atomic_write(release_directory / "manifest.json", manifest_object.content)
        _atomic_write(self._directory / "active.json", pointer_object.content)
        self._prune_releases(manifest.corpus_version)
        return CorpusRelease(release_directory, manifest)

    def _prune_releases(self, active_version: str) -> None:
        """Keep the active release and one rollback release on ephemeral disk."""
        if not self._directory.exists():
            return
        candidates = [
            path
            for path in self._directory.iterdir()
            if path.is_dir() and _SAFE_PATH_COMPONENT.fullmatch(path.name)
        ]
        candidates.sort(
            key=lambda path: path.stat().st_mtime_ns if path.exists() else 0,
            reverse=True,
        )
        keep = {self._directory / active_version}
        for path in candidates:
            if path not in keep and len(keep) < 2:
                keep.add(path)
        for path in candidates:
            if path not in keep:
                shutil.rmtree(path, ignore_errors=True)

    def open_cached(self) -> CorpusRelease:
        try:
            pointer = ActivePointer.model_validate_json(
                (self._directory / "active.json").read_bytes()
            )
            manifest_path = self._directory / pointer.corpus_version / "manifest.json"
            manifest_bytes = manifest_path.read_bytes()
            _verify_object(
                manifest_bytes,
                byte_size=pointer.manifest_byte_size,
                sha256=pointer.manifest_sha256,
                label="cached manifest",
            )
            manifest = ReleaseManifest.model_validate_json(manifest_bytes)
        except (OSError, ValueError) as error:
            raise CorpusError("no valid cached corpus; run the sync command first") from error
        for book in manifest.books:
            path = self._directory / manifest.corpus_version / "books" / f"{book.book_id}.sqlite"
            if not _matches_file(path, book.byte_size, book.sha256):
                raise CorpusError(f"cached corpus artifact is missing or corrupt: {book.book_id}")
            _validate_artifact(path, manifest, book)
        return CorpusRelease(self._directory / manifest.corpus_version, manifest)


class CorpusRelease:
    """Search one already-verified immutable release across independently indexed books."""

    def __init__(self, directory: Path, manifest: ReleaseManifest) -> None:
        self._directory = directory
        self._manifest = manifest
        self.corpus_version = manifest.corpus_version

    @property
    def model_input_limit(self) -> int:
        return self._manifest.compatibility.model_input_limit

    @property
    def embedding_dimensions(self) -> int:
        return self._manifest.compatibility.embedding_dimensions

    @property
    def query_task_type(self) -> str:
        return self._manifest.compatibility.query_task_type

    @property
    def book_ids(self) -> tuple[str, ...]:
        return tuple(book.book_id for book in self._manifest.books)

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
            path = self._directory / "books" / f"{book.book_id}.sqlite"
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


def _validate_artifact(path: Path, manifest: ReleaseManifest, book: PublishedBook) -> None:
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
        compatibility = manifest.compatibility
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
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
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
    # Keep adversarial retrieval text from expanding into an unbounded FTS5
    # expression. Semantic retrieval still sees the complete bounded query.
    tokens = [
        token
        for token in dict.fromkeys(re.findall(r"[^\W_]+", query.casefold(), flags=re.UNICODE))
        if len(token) >= 2
    ][:MAX_FTS_TOKENS]
    return " OR ".join(f'"{token}"' for token in tokens)


def _verify_object(content: bytes, *, byte_size: int, sha256: str, label: str) -> None:
    if len(content) != byte_size or hashlib.sha256(content).hexdigest() != sha256:
        raise CorpusError(f"{label} object failed size or SHA-256 verification")


def _matches_file(path: Path, byte_size: int, sha256: str) -> bool:
    try:
        if path.stat().st_size != byte_size:
            return False
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for block in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest() == sha256
    except OSError:
        return False


def _atomic_write(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        temporary_path.replace(destination)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _require_digest(value: str, label: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
