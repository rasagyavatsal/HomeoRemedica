from __future__ import annotations

import json
import os
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path

from homeoremedica_corpus.artifacts import (
    ArtifactSpec,
    BuiltArtifact,
    create_book_artifact,
)
from homeoremedica_corpus.chunking import (
    DEFAULT_CHUNKING_POLICY,
    ChunkingPolicy,
    chunk_book,
    corpus_hash,
)
from homeoremedica_corpus.contracts import EvaluationGate
from homeoremedica_corpus.embeddings import (
    EmbeddingProvider,
    embed_chunks,
    preflight_embedding_inputs,
)
from homeoremedica_corpus.sources import Book, CorpusValidationError


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
    evaluation: EvaluationGate | None = None,
    manifest_schema_version: int = 1,
    embedding_workers: int = 1,
    progress: Callable[[str], None] | None = None,
) -> BuiltRelease:
    """Preflight, embed, and atomically expose one complete local release."""
    if not books:
        raise ValueError("cannot build an empty corpus release")
    if len({book.book_id for book in books}) != len(books):
        raise ValueError("corpus release contains duplicate book IDs")
    release_directory = output_root / spec.corpus_version
    if release_directory.exists():
        raise FileExistsError(f"Refusing to overwrite release: {release_directory}")

    chunks_by_book = tuple((book, chunk_book(book, chunking)) for book in books)
    all_chunks = tuple(chunk for _, chunks in chunks_by_book for chunk in chunks)
    complete_hash = corpus_hash(all_chunks)
    if evaluation is not None and evaluation.corpus_hash != complete_hash:
        raise CorpusValidationError(
            "retrieval evaluation is stale for this corpus "
            f"(evaluated={evaluation.corpus_hash}, current={complete_hash})"
        )
    resolved_spec = replace(spec, corpus_hash=complete_hash)

    preflight_embedding_inputs(
        all_chunks,
        provider,
        model_input_limit=resolved_spec.embedding.model_input_limit,
        workers=embedding_workers,
        progress=_progress_counter(progress, "counted embedding tokens"),
    )

    output_root.mkdir(parents=True, exist_ok=True)
    temporary_directory = Path(tempfile.mkdtemp(prefix=f".{spec.corpus_version}.", dir=output_root))
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
        descriptor = _build_descriptor(
            resolved_spec,
            complete_hash,
            tuple(artifacts),
            evaluation,
            manifest_schema_version,
        )
        (temporary_directory / "build.json").write_text(
            json.dumps(descriptor, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        os.rename(temporary_directory, release_directory)
        final_artifacts = tuple(
            replace(
                artifact, path=release_directory / artifact.path.relative_to(temporary_directory)
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
        if temporary_directory.exists():
            shutil.rmtree(temporary_directory)


def _progress_counter(
    progress: Callable[[str], None] | None, label: str
) -> Callable[[int, int], None] | None:
    if progress is None:
        return None

    def report(completed: int, total: int) -> None:
        if completed == total or completed % 500 == 0:
            progress(f"{label}: {completed}/{total}")

    return report


def _build_descriptor(
    spec: ArtifactSpec,
    complete_hash: str,
    artifacts: tuple[BuiltArtifact, ...],
    evaluation: EvaluationGate | None,
    manifest_schema_version: int,
) -> dict[str, object]:
    return {
        "artifactSchemaVersion": spec.artifact_schema_version,
        "books": [
            {
                "author": artifact.author,
                "bookId": artifact.book_id,
                "byteSize": artifact.byte_size,
                "chunkCount": artifact.chunk_count,
                "filename": f"books/{artifact.book_id}.sqlite",
                "passageCount": artifact.passage_count,
                "sha256": artifact.sha256,
                "sourceSha256": artifact.source_sha256,
                "title": artifact.title,
            }
            for artifact in artifacts
        ],
        "compatibility": {
            "distanceFunction": spec.embedding.distance_function,
            "documentTaskType": spec.embedding.document_task_type,
            "embeddingDimensions": spec.embedding.dimensions,
            "embeddingModel": spec.embedding.model,
            "embeddingNormalization": spec.embedding.normalization,
            "modelInputLimit": spec.embedding.model_input_limit,
            "queryTaskType": spec.embedding.query_task_type,
            "sqliteVecVersion": spec.sqlite_vec_version,
            "sqliteVersion": spec.sqlite_version,
        },
        "corpusHash": complete_hash,
        "corpusVersion": spec.corpus_version,
        "evaluation": (
            evaluation.model_dump(mode="json", by_alias=True) if evaluation is not None else None
        ),
        "manifestSchemaVersion": manifest_schema_version,
    }
