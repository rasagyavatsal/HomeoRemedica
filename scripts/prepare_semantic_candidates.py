"""Prepare exhaustive cosine candidate caches from existing document embeddings.

NumPy is a development dependency. This optional preparation command bounds the
document working set instead of loading a second full vector index into SQLite.
The evaluator can also build its candidates normally through sqlite-vec.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path

import numpy as np

from homeoremedica_corpus.chunking import corpus_hash
from homeoremedica_evaluation import evaluation
from homeoremedica_evaluation.cli import _load_chunks
from homeoremedica_evaluation.config import load_evaluation_config
from homeoremedica_evaluation.embeddings import OpenRouterEmbeddingProvider
from homeoremedica_evaluation.paths import evaluation_path
from homeoremedica_evaluation.retrieval import (
    DEFAULT_HYBRID_RETRIEVAL_POLICY,
    ScoredCandidate,
)

ROOT = Path(__file__).resolve().parents[1]


def _normalized(vectors):
    result = np.array(vectors, dtype=np.float32, copy=True)
    norms = np.sqrt(np.einsum("ij,ij->i", result, result, dtype=np.float64))
    if np.any(~np.isfinite(norms)) or np.any(norms == 0):
        raise ValueError("cosine search requires finite, nonzero vectors")
    result /= norms[:, None]
    return result


def exhaustive_cosine_top_k(documents, queries, *, limit, block_size=4096, progress=None):
    """Search every document; equal-distance boundary ties may choose either row."""
    if limit <= 0 or block_size <= 0:
        raise ValueError("candidate limit and document block size must be positive")
    if (
        documents.ndim != 2
        or queries.ndim != 2
        or documents.shape[1] != queries.shape[1]
        or documents.shape[1] == 0
        or len(documents) == 0
    ):
        raise ValueError("search requires nonempty documents with matching vector dimensions")
    queries = _normalized(queries)
    limit = min(limit, len(documents))
    top_scores = np.empty((len(queries), 0), dtype=np.float32)
    top_ids = np.empty((len(queries), 0), dtype=np.int64)
    for start in range(0, len(documents), block_size):
        block = _normalized(documents[start : start + block_size])
        scores = queries @ block.T
        count = min(limit, len(block))
        indexes = np.argpartition(scores, -count, axis=1)[:, -count:]
        scores = np.concatenate((top_scores, np.take_along_axis(scores, indexes, axis=1)), axis=1)
        candidates = np.concatenate((top_ids, indexes + start), axis=1)
        count = min(limit, scores.shape[1])
        indexes = np.argpartition(scores, -count, axis=1)[:, -count:]
        top_scores = np.take_along_axis(scores, indexes, axis=1)
        top_ids = np.take_along_axis(candidates, indexes, axis=1)
        if progress is not None:
            progress(min(start + block_size, len(documents)), len(documents))
    order = np.lexsort((top_ids, -top_scores), axis=1)
    return np.take_along_axis(top_ids, order, axis=1), np.take_along_axis(top_scores, order, axis=1)


def _open_vectors(path, count, dimensions):
    if path is None or not path.is_file():
        raise FileNotFoundError(f"embedding cache is missing: {path}")
    if path.stat().st_size != count * dimensions * np.dtype(np.float32).itemsize:
        raise ValueError(f"embedding cache has an invalid byte size: {path}")
    return np.memmap(path, dtype=np.float32, mode="r", shape=(count, dimensions))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path)
    parser.add_argument(
        "--embed-queries",
        action="store_true",
        help="call OpenRouter if query embeddings are missing",
    )
    args = parser.parse_args()
    config = load_evaluation_config(ROOT / "evaluation.toml")
    _, chunks = _load_chunks(config)
    dataset_path = evaluation_path(args.dataset or config.dataset, ROOT)
    dataset, _ = evaluation.load_evaluation_dataset(dataset_path)
    inputs = tuple(text for group in dataset.semantic_input_groups for text in group)
    directory = config.cache_directory
    native = config.embedding.native_dimensions
    document_path = evaluation._embedding_cache_path(
        directory,
        "documents",
        config.embedding.model,
        native,
        tuple(chunk.embedding_text for chunk in chunks),
    )
    documents = _open_vectors(document_path, len(chunks), native)
    query_path = evaluation._embedding_cache_path(
        directory, "queries", config.embedding.model, native, inputs
    )
    assert query_path is not None
    if not query_path.is_file() and args.embed_queries:
        evaluation._embed_provider_vectors(
            inputs,
            OpenRouterEmbeddingProvider(replace(config.embedding, dimensions=native)),
            "embed_query",
            "embed_queries",
            native,
            8,
            lambda done, total: print(f"embedded queries {done}/{total}", flush=True)
            if done % 128 == 0 or done == total
            else None,
            cache_path=query_path,
        )
    queries = _open_vectors(query_path, len(inputs), native)
    chunk_ids = tuple(chunk.id for chunk in chunks)
    limit = min(len(chunks), max(dataset.k, dataset.candidate_pool_size))
    for dimension in config.dimensions:
        path = evaluation._ranking_cache_path(
            directory,
            "semantic",
            corpus_hash(chunks),
            config.embedding.model,
            dimension,
            limit,
            inputs,
            DEFAULT_HYBRID_RETRIEVAL_POLICY,
        )
        assert path is not None
        if path.exists():
            print(f"preserved existing candidates: {path}")
            continue
        indexes, scores = exhaustive_cosine_top_k(
            documents[:, :dimension],
            queries[:, :dimension],
            limit=limit,
            progress=lambda done, total: print(f"scanned documents {done}/{total}", flush=True),
        )
        rankings = tuple(
            tuple(
                ScoredCandidate(chunk_ids[int(index)], float(score))
                for index, score in zip(row_ids, row_scores, strict=True)
            )
            for row_ids, row_scores in zip(indexes, scores, strict=True)
        )
        evaluation._store_scored_ranking_cache(path, chunk_ids, rankings)
        print(f"cached exhaustive {dimension}-dimension cosine candidates: {path}")


if __name__ == "__main__":
    main()
