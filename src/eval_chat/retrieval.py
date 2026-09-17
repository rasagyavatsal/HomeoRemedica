"""Retrieval implementations owned by the experimental evaluation pipeline."""

from __future__ import annotations

import math
import re
import sqlite3
import unicodedata
from array import array
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import sqlite_vec

from corpus.chunking import Chunk

FTS5_TOKENIZER = "porter unicode61 remove_diacritics 2"

# These function words can overwhelm an OR query with narrative matches. Keep
# negation, timing, direction, and modalities (e.g. not, before, down, worse).
_LEXICAL_FUNCTION_WORD_TEXT = (
    "a an the and or of to in on at for from by with as it its is are was were be been "
    "being he she they we you i his her their our your my him them us me this that these "
    "those there here who whom which what when where how why have has had having do "
    "does did doing can could would should will shall may might must also very just "
    "then than so because if but about into through each some any all both such only "
    "other another own same now once while again further too s t"
)
LEXICAL_FUNCTION_WORDS = frozenset(_LEXICAL_FUNCTION_WORD_TEXT.split())


def lexical_content_terms(query: str) -> str:
    """Filter lexical function words; the semantic query retains the full text."""
    return " ".join(
        token
        for token in re.findall(r"[^\W_]+", query.casefold(), flags=re.UNICODE)
        if token not in LEXICAL_FUNCTION_WORDS
    )


def normalized_remedy_name(name: str) -> str:
    """Unify typography without guessing aliases or changing source display names."""
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


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


@dataclass(frozen=True, slots=True)
class ScoredCandidate:
    chunk_id: str
    score: float

    def __post_init__(self) -> None:
        if not self.chunk_id or not math.isfinite(self.score):
            raise ValueError("scored retrieval candidates require an ID and a finite score")


def rank_lexical_queries(
    chunks: Sequence[Chunk],
    queries: Iterable[str],
    *,
    limit: int,
    policy: HybridRetrievalPolicy = DEFAULT_HYBRID_RETRIEVAL_POLICY,
) -> tuple[tuple[str, ...], ...]:
    """Rank natural-language queries with the same FTS5 contract as release artifacts."""
    return tuple(
        tuple(candidate.chunk_id for candidate in ranking)
        for ranking in score_lexical_queries(chunks, queries, limit=limit, policy=policy)
    )


def score_lexical_queries(
    chunks: Sequence[Chunk],
    queries: Iterable[str],
    *,
    limit: int,
    policy: HybridRetrievalPolicy = DEFAULT_HYBRID_RETRIEVAL_POLICY,
) -> tuple[tuple[ScoredCandidate, ...], ...]:
    """Return FTS5 candidates with higher-is-better BM25 relevance scores."""
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
            ((chunk.id, chunk.text, chunk.remedy_name, chunk.section_title) for chunk in chunks),
        )
        rankings = []
        for query in queries:
            match_query = _fts_or_query(query)
            if not match_query:
                rankings.append(())
                continue
            rows = connection.execute(
                """
                SELECT chunk_id, bm25(chunks_fts, 0.0, ?, ?, ?)
                FROM chunks_fts
                WHERE chunks_fts MATCH ?
                ORDER BY bm25(chunks_fts, 0.0, ?, ?, ?), chunk_id
                LIMIT ?
                """,
                (
                    policy.text_weight,
                    policy.remedy_weight,
                    policy.section_weight,
                    match_query,
                    policy.text_weight,
                    policy.remedy_weight,
                    policy.section_weight,
                    limit,
                ),
            )
            rankings.append(
                tuple(ScoredCandidate(chunk_id=str(row[0]), score=-float(row[1])) for row in rows)
            )
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
    return tuple(
        tuple(candidate.chunk_id for candidate in ranking)
        for ranking in score_semantic_queries(
            chunk_ids,
            document_vectors,
            query_vectors,
            dimensions=dimensions,
            limit=limit,
        )
    )


def score_semantic_queries(
    chunk_ids: Sequence[str],
    document_vectors: Sequence[Sequence[float]],
    query_vectors: Iterable[Sequence[float]],
    *,
    dimensions: int,
    limit: int,
) -> tuple[tuple[ScoredCandidate, ...], ...]:
    """Return sqlite-vec candidates with higher-is-better cosine similarity scores."""
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
                SELECT chunk_rowid, distance
                FROM chunk_vectors
                WHERE embedding MATCH ? AND k = ?
                ORDER BY distance
                """,
                (_normalized_prefix(vector, dimensions), actual_limit),
            )
            rankings.append(
                tuple(
                    ScoredCandidate(chunk_id=chunk_ids[int(row[0]) - 1], score=1.0 - float(row[1]))
                    for row in rows
                )
            )
        return tuple(rankings)
    finally:
        connection.close()


class PreparedRetrievalIndex:
    """Keep the evaluation FTS and vector indexes ready for an interactive session."""

    def __init__(
        self,
        chunks: Sequence[Chunk],
        document_vectors: Iterable[Sequence[float]] | None,
        *,
        dimensions: int,
        policy: HybridRetrievalPolicy = DEFAULT_HYBRID_RETRIEVAL_POLICY,
        cache_path: Path | None = None,
        cache_key: str | None = None,
    ) -> None:
        if dimensions <= 0 or (cache_path is None) != (cache_key is None):
            raise ValueError("experimental index dimensions or cache identity are invalid")
        self._chunks = tuple(chunks)
        self._dimensions = dimensions
        self._policy = policy
        if cache_path is not None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            if cache_path.is_symlink():
                raise ValueError("experimental index cache must not be a symbolic link")
            if cache_path.is_file():
                cached = sqlite3.connect(cache_path)
                try:
                    _load_vec(cached)
                    identity = cached.execute(
                        "SELECT value FROM index_metadata WHERE key = 'cache_key'"
                    ).fetchone()
                    vector_count = cached.execute("SELECT count(*) FROM chunk_vectors").fetchone()
                    lexical_count = cached.execute("SELECT count(*) FROM chunks_fts").fetchone()
                    if (
                        identity == (cache_key,)
                        and vector_count == (len(self._chunks),)
                        and lexical_count == (len(self._chunks),)
                    ):
                        self._connection = cached
                        return
                except sqlite3.DatabaseError:
                    pass
                cached.close()
                cache_path.unlink()
        if document_vectors is None:
            raise ValueError("document vectors are required to build an experimental index")
        connection = sqlite3.connect(cache_path or ":memory:")
        self._connection = connection
        try:
            if cache_path is not None:
                # A partial cache is rebuilt on the next launch, so avoid a large rollback journal.
                connection.execute("PRAGMA journal_mode=OFF")
                connection.execute("PRAGMA synchronous=OFF")
            _load_vec(connection)
            if cache_key is not None:
                connection.execute("CREATE TABLE index_metadata(key TEXT PRIMARY KEY, value TEXT)")
                connection.execute(
                    "INSERT INTO index_metadata(key, value) VALUES ('cache_key', ?)",
                    (cache_key,),
                )
            connection.execute(
                f"""CREATE VIRTUAL TABLE chunks_fts USING fts5(
                    chunk_id UNINDEXED, text, remedy_name, section_title,
                    tokenize='{FTS5_TOKENIZER}'
                )"""
            )
            connection.executemany(
                "INSERT INTO chunks_fts(chunk_id, text, remedy_name, section_title) "
                "VALUES (?, ?, ?, ?)",
                (
                    (chunk.id, chunk.text, chunk.remedy_name, chunk.section_title)
                    for chunk in self._chunks
                ),
            )
            connection.execute(
                f"""CREATE VIRTUAL TABLE chunk_vectors USING vec0(
                    chunk_rowid INTEGER PRIMARY KEY,
                    embedding float[{dimensions}] distance_metric=cosine
                )"""
            )
            connection.executemany(
                "INSERT INTO chunk_vectors(chunk_rowid, embedding) VALUES (?, ?)",
                (
                    (rowid, _normalized_prefix(vector, dimensions))
                    for rowid, vector in enumerate(document_vectors, start=1)
                ),
            )
            count = connection.execute("SELECT count(*) FROM chunk_vectors").fetchone()
            if count != (len(self._chunks),):
                raise ValueError("experimental chunks and document vectors have different lengths")
            connection.commit()
        except Exception:
            connection.close()
            if cache_path is not None:
                cache_path.unlink(missing_ok=True)
            raise

    def score_lexical(self, query: str, *, limit: int) -> tuple[ScoredCandidate, ...]:
        if limit <= 0:
            raise ValueError("lexical result limit must be positive")
        match_query = _fts_or_query(query)
        if not match_query:
            return ()
        policy = self._policy
        rows = self._connection.execute(
            """SELECT chunk_id, bm25(chunks_fts, 0.0, ?, ?, ?)
            FROM chunks_fts WHERE chunks_fts MATCH ?
            ORDER BY bm25(chunks_fts, 0.0, ?, ?, ?), chunk_id LIMIT ?""",
            (
                policy.text_weight,
                policy.remedy_weight,
                policy.section_weight,
                match_query,
                policy.text_weight,
                policy.remedy_weight,
                policy.section_weight,
                limit,
            ),
        )
        return tuple(ScoredCandidate(str(row[0]), -float(row[1])) for row in rows)

    def score_semantic(self, vector: Sequence[float], *, limit: int) -> tuple[ScoredCandidate, ...]:
        if limit <= 0:
            raise ValueError("semantic result limit must be positive")
        if not self._chunks:
            return ()
        rows = self._connection.execute(
            """SELECT chunk_rowid, distance FROM chunk_vectors
            WHERE embedding MATCH ? AND k = ? ORDER BY distance""",
            (_normalized_prefix(vector, self._dimensions), min(limit, len(self._chunks))),
        )
        return tuple(
            ScoredCandidate(self._chunks[int(row[0]) - 1].id, 1.0 - float(row[1])) for row in rows
        )

    def close(self) -> None:
        self._connection.close()


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
    return sqlite_vec.serialize_float32([
        float(values[index]) / norm for index in range(dimensions)
    ])


def _load_vec(connection: sqlite3.Connection) -> None:
    connection.enable_load_extension(True)
    try:
        sqlite_vec.load(connection)
    finally:
        connection.enable_load_extension(False)
