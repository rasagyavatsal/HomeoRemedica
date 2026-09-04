from __future__ import annotations

import math
import re
import sqlite3
from array import array
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import sqlite_vec

from homeoremedica_corpus.chunking import Chunk

FTS5_TOKENIZER = "porter unicode61 remove_diacritics 2"


@dataclass(frozen=True, slots=True)
class HybridRetrievalPolicy:
    candidate_pool_size: int = 100
    reciprocal_rank_constant: int = 60
    text_weight: float = 3.0
    remedy_weight: float = 2.0
    section_weight: float = 1.0

    def __post_init__(self) -> None:
        if self.candidate_pool_size <= 0 or self.reciprocal_rank_constant <= 0:
            raise ValueError("hybrid retrieval limits must be positive")
        if any(
            not math.isfinite(weight) or weight <= 0
            for weight in (self.text_weight, self.remedy_weight, self.section_weight)
        ):
            raise ValueError("lexical ranking weights must be finite and positive")


DEFAULT_HYBRID_RETRIEVAL_POLICY = HybridRetrievalPolicy()


def rank_lexical_queries(
    chunks: Sequence[Chunk],
    queries: Iterable[str],
    *,
    limit: int,
    policy: HybridRetrievalPolicy = DEFAULT_HYBRID_RETRIEVAL_POLICY,
) -> tuple[tuple[str, ...], ...]:
    """Rank natural-language queries with the same FTS5 contract as release artifacts."""
    if limit <= 0:
        raise ValueError("lexical result limit must be positive")
    connection = sqlite3.connect(":memory:")
    try:
        connection.execute(
            f"""
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                chunk_id UNINDEXED,
                text,
                remedy_name,
                section_title,
                tokenize='{FTS5_TOKENIZER}'
            )
            """
        )
        connection.executemany(
            "INSERT INTO chunks_fts(chunk_id, text, remedy_name, section_title) "
            "VALUES (?, ?, ?, ?)",
            (
                (chunk.id, chunk.text, chunk.remedy_name, chunk.section_title)
                for chunk in chunks
            ),
        )
        rankings = []
        for query in queries:
            match_query = _fts_or_query(query)
            if not match_query:
                rankings.append(())
                continue
            rows = connection.execute(
                """
                SELECT chunk_id
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY bm25(chunks_fts, 0.0, ?, ?, ?), chunk_id
                LIMIT ?
                """,
                (
                    match_query,
                    policy.text_weight,
                    policy.remedy_weight,
                    policy.section_weight,
                    limit,
                ),
            )
            rankings.append(tuple(str(row[0]) for row in rows))
        return tuple(rankings)
    finally:
        connection.close()


def rank_semantic_queries(
    chunk_ids: Sequence[str],
    document_vectors: Sequence[Sequence[float]],
    query_vectors: Iterable[Sequence[float]],
    *,
    dimensions: int,
    limit: int,
) -> tuple[tuple[str, ...], ...]:
    """Rank vector prefixes through sqlite-vec, matching the released vector index."""
    if dimensions <= 0 or limit <= 0:
        raise ValueError("semantic dimensions and result limit must be positive")
    if len(chunk_ids) != len(document_vectors):
        raise ValueError("semantic chunk IDs and document vectors must have equal lengths")
    if not chunk_ids:
        return tuple(() for _ in query_vectors)

    connection = sqlite3.connect(":memory:")
    try:
        _load_vec(connection)
        connection.execute(
            f"""
            CREATE VIRTUAL TABLE chunk_vectors USING vec0(
                chunk_rowid INTEGER PRIMARY KEY,
                embedding float[{dimensions}] distance_metric=cosine
            )
            """
        )
        connection.executemany(
            "INSERT INTO chunk_vectors(chunk_rowid, embedding) VALUES (?, ?)",
            (
                (rowid, _normalized_prefix(vector, dimensions))
                for rowid, vector in enumerate(document_vectors, start=1)
            ),
        )
        actual_limit = min(limit, len(chunk_ids))
        rankings = []
        for vector in query_vectors:
            rows = connection.execute(
                """
                SELECT chunk_rowid
                FROM chunk_vectors
                WHERE embedding MATCH ? AND k = ?
                ORDER BY distance
                """,
                (_normalized_prefix(vector, dimensions), actual_limit),
            )
            rankings.append(tuple(chunk_ids[int(row[0]) - 1] for row in rows))
        return tuple(rankings)
    finally:
        connection.close()


def reciprocal_rank_fusion(
    rankings: Iterable[Sequence[str]], *, rank_constant: int
) -> tuple[str, ...]:
    if rank_constant <= 0:
        raise ValueError("reciprocal rank constant must be positive")
    scores: dict[str, float] = {}
    best_ranks: dict[str, int] = {}
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1 / (rank_constant + rank)
            best_ranks[chunk_id] = min(rank, best_ranks.get(chunk_id, rank))
    return tuple(sorted(scores, key=lambda item: (-scores[item], best_ranks[item], item)))


def materialize_float32(values: Iterable[float], dimensions: int) -> array[float]:
    vector = array("f", (float(value) for value in values))
    if len(vector) != dimensions:
        raise RuntimeError(f"expected {dimensions} embedding dimensions, got {len(vector)}")
    norm = math.sqrt(math.fsum(value * value for value in vector))
    if norm == 0 or not math.isfinite(norm):
        raise RuntimeError("evaluation provider returned an invalid zero or non-finite vector")
    return vector


def _fts_or_query(query: str) -> str:
    tokens = dict.fromkeys(re.findall(r"[^\W_]+", query.casefold(), flags=re.UNICODE))
    return " OR ".join(f'"{token}"' for token in tokens if len(token) >= 2)


def _normalized_prefix(values: Sequence[float], dimensions: int) -> bytes:
    if len(values) < dimensions:
        raise RuntimeError(
            f"cannot derive {dimensions} dimensions from a {len(values)}-dimension embedding"
        )
    norm = math.sqrt(math.fsum(float(values[index]) ** 2 for index in range(dimensions)))
    if norm == 0 or not math.isfinite(norm):
        raise RuntimeError("embedding prefix has an invalid zero or non-finite norm")
    return sqlite_vec.serialize_float32(
        [float(values[index]) / norm for index in range(dimensions)]
    )


def _load_vec(connection: sqlite3.Connection) -> None:
    connection.enable_load_extension(True)
    try:
        sqlite_vec.load(connection)
    finally:
        connection.enable_load_extension(False)
