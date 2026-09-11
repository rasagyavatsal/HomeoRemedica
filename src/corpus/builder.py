from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path

from corpus.artifacts import (
    ArtifactSpec,
    BuiltArtifact,
    create_book_artifact,
    sha256_file,
    validate_book_artifact,
)
from corpus.chunking import (
    DEFAULT_CHUNKING_POLICY,
    ChunkingPolicy,
    chunk_book,
    corpus_hash,
)
from corpus.contracts import (
    ActivePointer,
    PublishedBook,
    ReleaseManifest,
    canonical_json_bytes,
    compatibility_from_artifact_spec,
)
from corpus.embeddings import (
    EmbeddingProvider,
    EmbeddingSpec,
    embed_chunks,
    preflight_embedding_inputs,
)
from corpus.sources import Book, CorpusValidationError


@dataclass(frozen=True, slots=True)
class BuiltRelease:
    corpus_version: str
    corpus_hash: str
    release_directory: Path
    artifacts: tuple[BuiltArtifact, ...]


def build_release(
    books: tuple[Book, ...],
    provider: EmbeddingProvider,
    *,
    output_root: Path,
    spec: ArtifactSpec,
    chunking: ChunkingPolicy = DEFAULT_CHUNKING_POLICY,
    manifest_schema_version: int = 2,
    embedding_workers: int = 1,
    progress: Callable[[str], None] | None = None,
) -> BuiltRelease:
    """Build, verify, and activate one complete local SQLite release."""
    if not books:
        raise ValueError("cannot build an empty corpus release")
    if len({book.book_id for book in books}) != len(books):
        raise ValueError("corpus release contains duplicate book IDs")
    if manifest_schema_version <= 0:
        raise ValueError("manifest schema version must be positive")

    output_root = _resolve_root(output_root)
    _ensure_directory_is_safe(output_root)
    release_directory = output_root / spec.corpus_version
    if release_directory.exists():
        raise FileExistsError(f"Refusing to overwrite release: {release_directory}")

    chunks_by_book = tuple((book, chunk_book(book, chunking)) for book in books)
    all_chunks = tuple(chunk for _, chunks in chunks_by_book for chunk in chunks)
    complete_hash = corpus_hash(all_chunks)
    resolved_spec = replace(spec, corpus_hash=complete_hash)

    preflight_embedding_inputs(
        all_chunks,
        provider,
        model_input_limit=resolved_spec.embedding.model_input_limit,
        workers=embedding_workers,
        progress=_progress_counter(progress, "counted embedding tokens"),
    )

    output_root.mkdir(parents=True, exist_ok=True)
    temporary_directory: Path | None = Path(
        tempfile.mkdtemp(prefix=f".{spec.corpus_version}.", dir=output_root)
    )
    try:
        artifacts = []
        for book, chunks in chunks_by_book:
            embedded = embed_chunks(
                chunks,
                provider,
                model_input_limit=resolved_spec.embedding.model_input_limit,
                preflight=False,
                workers=embedding_workers,
                progress=_progress_counter(progress, f"embedded {book.book_id} chunks"),
            )
            artifacts.append(
                create_book_artifact(
                    temporary_directory / "books" / f"{book.book_id}.sqlite",
                    book,
                    embedded,
                    resolved_spec,
                )
            )

        manifest = _build_manifest(
            resolved_spec,
            complete_hash,
            tuple(artifacts),
            manifest_schema_version,
        )
        manifest_bytes = canonical_json_bytes(manifest)
        (temporary_directory / "manifest.json").write_bytes(manifest_bytes)
        _verify_manifest_files(temporary_directory, manifest, resolved_spec)

        assert temporary_directory is not None
        os.replace(temporary_directory, release_directory)
        temporary_directory = None
        _activate_manifest(output_root, release_directory, manifest, manifest_bytes)

        final_artifacts = tuple(
            replace(
                artifact,
                path=release_directory / artifact.path.relative_to(artifact.path.parents[1]),
            )
            for artifact in artifacts
        )
        return BuiltRelease(
            corpus_version=spec.corpus_version,
            corpus_hash=complete_hash,
            release_directory=release_directory,
            artifacts=final_artifacts,
        )
    finally:
        if temporary_directory is not None and temporary_directory.exists():
            shutil.rmtree(temporary_directory)


def activate_release(output_root: Path, corpus_version: str) -> ActivePointer:
    """Verify an existing release and atomically point ``active.json`` at it."""
    root = _resolve_root(output_root)
    _ensure_directory_is_safe(root)
    release_directory = root / corpus_version
    manifest_path = release_directory / "manifest.json"
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = ReleaseManifest.model_validate_json(manifest_bytes)
    except (OSError, ValueError) as error:
        raise CorpusValidationError(
            f"invalid local corpus release {corpus_version}: {error}"
        ) from error
    spec = _artifact_spec(manifest)
    _verify_manifest_files(release_directory, manifest, spec, require_version_directory=True)
    return _activate_manifest(root, release_directory, manifest, manifest_bytes)


def _activate_manifest(
    output_root: Path,
    release_directory: Path,
    manifest: ReleaseManifest,
    manifest_bytes: bytes,
) -> ActivePointer:
    relative_manifest = release_directory.relative_to(output_root) / "manifest.json"
    pointer = ActivePointer(
        corpus_version=manifest.corpus_version,
        manifest_path=relative_manifest.as_posix(),
        manifest_byte_size=len(manifest_bytes),
        manifest_sha256=_sha256_bytes(manifest_bytes),
    )
    _atomic_write(output_root / "active.json", canonical_json_bytes(pointer))
    return pointer


def _verify_manifest_files(
    release_directory: Path,
    manifest: ReleaseManifest,
    spec: ArtifactSpec,
    *,
    require_version_directory: bool = False,
) -> None:
    if require_version_directory and manifest.corpus_version != release_directory.name:
        raise CorpusValidationError("manifest version does not match its release directory")
    for book in manifest.books:
        path = release_directory / book.filename
        if not path.is_file():
            raise CorpusValidationError(f"release is incomplete: missing {book.filename}")
        if path.stat().st_size != book.byte_size or sha256_file(path) != book.sha256:
            raise CorpusValidationError(f"artifact digest verification failed: {book.filename}")
        validated = validate_book_artifact(path, spec)
        if (
            validated.book_id != book.book_id
            or validated.title != book.title
            or validated.author != book.author
            or validated.source_sha256 != book.source_sha256
            or validated.chunk_count != book.chunk_count
            or validated.passage_count != book.passage_count
        ):
            raise CorpusValidationError(f"artifact metadata mismatch: {book.filename}")


def _build_manifest(
    spec: ArtifactSpec,
    complete_hash: str,
    artifacts: tuple[BuiltArtifact, ...],
    manifest_schema_version: int,
) -> ReleaseManifest:
    return ReleaseManifest(
        manifest_schema_version=manifest_schema_version,
        artifact_schema_version=spec.artifact_schema_version,
        corpus_version=spec.corpus_version,
        corpus_hash=complete_hash,
        compatibility=compatibility_from_artifact_spec(spec),
        books=tuple(
            PublishedBook(
                author=artifact.author,
                book_id=artifact.book_id,
                byte_size=artifact.byte_size,
                chunk_count=artifact.chunk_count,
                filename=f"books/{artifact.book_id}.sqlite",
                passage_count=artifact.passage_count,
                sha256=artifact.sha256,
                source_sha256=artifact.source_sha256,
                title=artifact.title,
            )
            for artifact in artifacts
        ),
    )


def _artifact_spec(manifest: ReleaseManifest) -> ArtifactSpec:
    compatibility = manifest.compatibility
    return ArtifactSpec(
        corpus_version=manifest.corpus_version,
        corpus_hash=manifest.corpus_hash,
        artifact_schema_version=manifest.artifact_schema_version,
        embedding=EmbeddingSpec(
            model=compatibility.embedding_model,
            dimensions=compatibility.embedding_dimensions,
            document_task_type=compatibility.document_task_type,
            query_task_type=compatibility.query_task_type,
            normalization=compatibility.embedding_normalization,
            distance_function=compatibility.distance_function,
            model_input_limit=compatibility.model_input_limit,
        ),
        sqlite_version=compatibility.sqlite_version,
        sqlite_vec_version=compatibility.sqlite_vec_version,
    )


def _ensure_directory_is_safe(path: Path) -> None:
    if path.exists() and not path.is_dir():
        raise CorpusValidationError(f"corpus artifact directory is not a directory: {path}")
    if path.is_symlink():
        raise CorpusValidationError(
            f"corpus artifact directory must not be a symbolic link: {path}"
        )


def _resolve_root(path: Path) -> Path:
    candidate = path.expanduser()
    if candidate.is_symlink():
        raise CorpusValidationError(
            f"corpus artifact directory must not be a symbolic link: {path}"
        )
    return candidate.resolve()


def _atomic_write(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        temporary_path.replace(destination)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _progress_counter(
    progress: Callable[[str], None] | None, label: str
) -> Callable[[int, int], None] | None:
    if progress is None:
        return None

    def report(completed: int, total: int) -> None:
        if completed == total or completed % 500 == 0:
            progress(f"{label}: {completed}/{total}")

    return report
