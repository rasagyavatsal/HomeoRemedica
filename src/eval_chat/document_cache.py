"""Stream experimental document vectors without retaining the corpus in memory."""

from __future__ import annotations

import os
import tempfile
from array import array
from collections.abc import Callable, Iterable, Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import cast

from corpus.chunking import Chunk
from eval_chat.embeddings import EMBEDDING_BATCH_SIZE, EmbeddingProvider
from eval_chat.retrieval import materialize_float32


def ensure_document_cache(
    chunks: Sequence[Chunk],
    provider: EmbeddingProvider,
    path: Path,
    *,
    dimensions: int,
    workers: int = 8,
    progress: Callable[[str], None] | None = None,
) -> None:
    if workers <= 0:
        raise ValueError("embedding workers must be positive")
    expected_bytes = len(chunks) * dimensions * array("f").itemsize
    if path.exists():
        if path.is_symlink() or path.stat().st_size != expected_bytes:
            raise RuntimeError(f"document embedding cache is invalid: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    batches = tuple(
        tuple(chunk.embedding_text for chunk in chunks[start : start + EMBEDDING_BATCH_SIZE])
        for start in range(0, len(chunks), EMBEDDING_BATCH_SIZE)
    )
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix="documents-", delete=False
        ) as output:
            temporary = Path(output.name)
            batch_embed = getattr(provider, "embed_documents", None)

            def embed(texts: tuple[str, ...]) -> tuple[tuple[float, ...], ...]:
                if callable(batch_embed):
                    typed_batch = cast(
                        Callable[[Sequence[str]], Iterable[Sequence[float]]], batch_embed
                    )
                    return tuple(tuple(vector) for vector in typed_batch(texts))
                return tuple(provider.embed_document(text) for text in texts)

            with ThreadPoolExecutor(max_workers=workers) as executor:
                results = executor.map(embed, batches, buffersize=workers)
                completed = 0
                for batch, vectors in zip(batches, results, strict=True):
                    if len(vectors) != len(batch):
                        raise RuntimeError("embedding provider returned the wrong vector count")
                    for vector in vectors:
                        materialize_float32(vector, dimensions).tofile(output)
                        completed += 1
                    if progress is not None and (
                        completed == len(chunks) or completed % (EMBEDDING_BATCH_SIZE * 16) == 0
                    ):
                        progress(f"Embedded {completed}/{len(chunks)} experimental chunks")
        if temporary.stat().st_size != expected_bytes:
            raise RuntimeError("document embedding cache has the wrong byte size")
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_document_vectors(path: Path, *, count: int, dimensions: int) -> Iterator[array[float]]:
    expected_bytes = count * dimensions * array("f").itemsize
    if path.stat().st_size != expected_bytes:
        raise RuntimeError(f"document embedding cache has an invalid byte size: {path}")
    with path.open("rb") as source:
        for _ in range(count):
            vector = array("f")
            vector.fromfile(source, dimensions)
            yield vector
