from __future__ import annotations

import hashlib
import math
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from homeoremedica_corpus.chunking import Chunk
from homeoremedica_corpus.contracts import Contract, EvaluationGate, canonical_json_bytes
from homeoremedica_corpus.embeddings import EmbeddingProvider, preflight_embedding_inputs
from homeoremedica_corpus.retrieval import (
    DEFAULT_HYBRID_RETRIEVAL_POLICY,
    FTS5_TOKENIZER,
    HybridRetrievalPolicy,
    materialize_float32,
    rank_lexical_queries,
    rank_semantic_queries,
    reciprocal_rank_fusion,
)
from homeoremedica_corpus.sources import CorpusValidationError

QualityMetric = Literal["recallAtK", "mrrAtK"]

# Clarke, Kolla, Cormack, Vechtomova, Ashkan, Buettcher, and MacKinnon (SIGIR 2008):
# each time a ranked chunk covers an intent a higher ranked chunk already covered,
# the gain that intent contributes is multiplied by (1 - alpha).
ALPHA_NOVELTY_DISCOUNT = 0.5


@dataclass(frozen=True, slots=True)
class RankingQuality:
    """Quality of one ranking strategy averaged over every evaluation query at depth k."""

    recall_at_k: float
    mrr_at_k: float
    ndcg_at_k: float
    alpha_ndcg_at_k: float
    evidence_precision_at_k: float


class EvaluationTarget(Contract):
    book_id: str
    remedy_name: str
    section_title: str | None = None
    passage_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_target(self) -> EvaluationTarget:
        if self.passage_index is not None and self.section_title is None:
            raise ValueError("passage_index requires section_title")
        return self


class EvaluationQuery(Contract):
    id: str
    query: str
    relevant: tuple[EvaluationTarget, ...] = Field(min_length=1)


class EvaluationDataset(Contract):
    version: str
    k: int = Field(gt=0)
    quality_metric: QualityMetric
    minimum_quality: float = Field(ge=0, le=1)
    queries: tuple[EvaluationQuery, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_queries(self) -> EvaluationDataset:
        identifiers = [query.id for query in self.queries]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("evaluation query IDs must be unique")
        if any(not query.id.strip() or not query.query.strip() for query in self.queries):
            raise ValueError("evaluation query IDs and text must be non-empty")
        return self


class DimensionScore(Contract):
    dimensions: int = Field(gt=0)
    semantic_recall_at_k: float = Field(ge=0, le=1)
    semantic_mrr_at_k: float = Field(ge=0, le=1)
    semantic_ndcg_at_k: float = Field(ge=0, le=1)
    semantic_alpha_ndcg_at_k: float = Field(ge=0, le=1)
    semantic_evidence_precision_at_k: float = Field(ge=0, le=1)
    recall_at_k: float = Field(ge=0, le=1)
    mrr_at_k: float = Field(ge=0, le=1)
    ndcg_at_k: float = Field(ge=0, le=1)
    alpha_ndcg_at_k: float = Field(ge=0, le=1)
    evidence_precision_at_k: float = Field(ge=0, le=1)
    quality_value: float = Field(ge=0, le=1)
    passed: bool


class EvaluationResult(Contract):
    evaluation_schema_version: int = 3
    dataset_version: str
    dataset_sha256: str
    corpus_hash: str
    model: str
    document_task_type: str = "RETRIEVAL_DOCUMENT"
    query_task_type: str = "RETRIEVAL_QUERY"
    normalization: str = "l2"
    distance_function: str = "cosine"
    k: int = Field(gt=0)
    alpha_discount: float = Field(default=ALPHA_NOVELTY_DISCOUNT, ge=0, lt=1)
    quality_metric: QualityMetric
    minimum_quality: float = Field(ge=0, le=1)
    retrieval_strategy: str = "fts5VectorRrf"
    lexical_tokenizer: str = FTS5_TOKENIZER
    candidate_pool_size: int = Field(gt=0)
    reciprocal_rank_constant: int = Field(gt=0)
    lexical_recall_at_k: float = Field(ge=0, le=1)
    lexical_mrr_at_k: float = Field(ge=0, le=1)
    lexical_ndcg_at_k: float = Field(ge=0, le=1)
    lexical_alpha_ndcg_at_k: float = Field(ge=0, le=1)
    lexical_evidence_precision_at_k: float = Field(ge=0, le=1)
    scores: tuple[DimensionScore, ...] = Field(min_length=2)
    chosen_dimensions: int | None = Field(default=None, gt=0)


def load_evaluation_dataset(path: Path) -> tuple[EvaluationDataset, str]:
    contents = path.read_bytes()
    return EvaluationDataset.model_validate_json(contents), hashlib.sha256(contents).hexdigest()


def run_dimension_evaluation(
    dataset: EvaluationDataset,
    chunks: Iterable[Chunk],
    provider_for_dimensions: Callable[[int], EmbeddingProvider],
    *,
    model: str,
    model_input_limit: int,
    dimensions: tuple[int, ...] = (768, 1536, 3072),
    corpus_hash: str,
    dataset_sha256: str,
    retrieval: HybridRetrievalPolicy = DEFAULT_HYBRID_RETRIEVAL_POLICY,
    workers: int = 1,
    progress: Callable[[str], None] | None = None,
) -> EvaluationResult:
    materialized_chunks = tuple(chunks)
    if not materialized_chunks:
        raise CorpusValidationError("cannot evaluate an empty corpus")
    if (
        len(dimensions) < 2
        or len(set(dimensions)) != len(dimensions)
        or any(d <= 0 for d in dimensions)
    ):
        raise ValueError("evaluation requires at least two unique positive dimensions")

    intents_by_query = _resolve_intents(dataset, materialized_chunks)
    maximum_dimensions = max(dimensions)
    provider = provider_for_dimensions(maximum_dimensions)
    _validate_provider_dimensions(provider, maximum_dimensions)
    if workers <= 0:
        raise ValueError("embedding workers must be positive")
    preflight_embedding_inputs(
        materialized_chunks,
        provider,
        model_input_limit,
        workers=workers,
        progress=_progress_counter(progress, "counted embedding tokens"),
    )

    document_vectors = _embed_vectors(
        (chunk.embedding_text for chunk in materialized_chunks),
        provider.embed_document,
        maximum_dimensions,
        workers,
        _progress_counter(progress, "embedded documents"),
    )
    query_vectors = _embed_vectors(
        (query.query for query in dataset.queries),
        provider.embed_query,
        maximum_dimensions,
        workers,
        _progress_counter(progress, "embedded queries"),
    )
    candidate_limit = min(
        len(materialized_chunks), max(dataset.k, retrieval.candidate_pool_size)
    )
    lexical_rankings = rank_lexical_queries(
        materialized_chunks,
        (query.query for query in dataset.queries),
        limit=candidate_limit,
        policy=retrieval,
    )
    lexical_quality = _mean_quality(
        _ranking_quality(lexical_rankings, intents_by_query, dataset.k, ALPHA_NOVELTY_DISCOUNT)
    )

    scores = []
    for dimension in dimensions:
        semantic_rankings = rank_semantic_queries(
            tuple(chunk.id for chunk in materialized_chunks),
            document_vectors,
            query_vectors,
            dimensions=dimension,
            limit=candidate_limit,
        )
        fused_rankings = tuple(
            reciprocal_rank_fusion(
                (semantic, lexical), rank_constant=retrieval.reciprocal_rank_constant
            )
            for semantic, lexical in zip(semantic_rankings, lexical_rankings, strict=True)
        )
        semantic_quality = _mean_quality(
            _ranking_quality(semantic_rankings, intents_by_query, dataset.k, ALPHA_NOVELTY_DISCOUNT)
        )
        fused_quality = _mean_quality(
            _ranking_quality(fused_rankings, intents_by_query, dataset.k, ALPHA_NOVELTY_DISCOUNT)
        )
        quality_value = (
            fused_quality.recall_at_k
            if dataset.quality_metric == "recallAtK"
            else fused_quality.mrr_at_k
        )
        scores.append(
            DimensionScore(
                dimensions=dimension,
                semantic_recall_at_k=semantic_quality.recall_at_k,
                semantic_mrr_at_k=semantic_quality.mrr_at_k,
                semantic_ndcg_at_k=semantic_quality.ndcg_at_k,
                semantic_alpha_ndcg_at_k=semantic_quality.alpha_ndcg_at_k,
                semantic_evidence_precision_at_k=semantic_quality.evidence_precision_at_k,
                recall_at_k=fused_quality.recall_at_k,
                mrr_at_k=fused_quality.mrr_at_k,
                ndcg_at_k=fused_quality.ndcg_at_k,
                alpha_ndcg_at_k=fused_quality.alpha_ndcg_at_k,
                evidence_precision_at_k=fused_quality.evidence_precision_at_k,
                quality_value=quality_value,
                passed=quality_value >= dataset.minimum_quality,
            )
        )
        if progress is not None:
            progress(f"ranked {dimension}-dimension hybrid retrieval")

    passing = [score.dimensions for score in scores if score.passed]
    return EvaluationResult(
        dataset_version=dataset.version,
        dataset_sha256=dataset_sha256,
        corpus_hash=corpus_hash,
        model=model,
        k=dataset.k,
        alpha_discount=ALPHA_NOVELTY_DISCOUNT,
        quality_metric=dataset.quality_metric,
        minimum_quality=dataset.minimum_quality,
        candidate_pool_size=retrieval.candidate_pool_size,
        reciprocal_rank_constant=retrieval.reciprocal_rank_constant,
        lexical_recall_at_k=lexical_quality.recall_at_k,
        lexical_mrr_at_k=lexical_quality.mrr_at_k,
        lexical_ndcg_at_k=lexical_quality.ndcg_at_k,
        lexical_alpha_ndcg_at_k=lexical_quality.alpha_ndcg_at_k,
        lexical_evidence_precision_at_k=lexical_quality.evidence_precision_at_k,
        scores=tuple(scores),
        chosen_dimensions=min(passing) if passing else None,
    )


def record_evaluation(path: Path, result: EvaluationResult) -> EvaluationGate:
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite evaluation result: {path}")
    contents = canonical_json_bytes(result)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as destination:
            destination.write(contents)
    except FileExistsError as error:
        raise FileExistsError(f"Refusing to overwrite evaluation result: {path}") from error
    if result.chosen_dimensions is None:
        raise CorpusValidationError(
            f"no evaluated embedding dimension met {result.quality_metric} >= "
            f"{result.minimum_quality}; failure recorded at {path}"
        )
    chosen = next(score for score in result.scores if score.dimensions == result.chosen_dimensions)
    return EvaluationGate(
        dataset_version=result.dataset_version,
        dataset_sha256=result.dataset_sha256,
        corpus_hash=result.corpus_hash,
        result_sha256=hashlib.sha256(contents).hexdigest(),
        metric=result.quality_metric,
        threshold=result.minimum_quality,
        value=chosen.quality_value,
        chosen_dimensions=result.chosen_dimensions,
    )


def load_evaluation_gate(path: Path) -> EvaluationGate:
    contents = path.read_bytes()
    result = EvaluationResult.model_validate_json(contents)
    if result.chosen_dimensions is None:
        raise CorpusValidationError(f"evaluation result has no passing dimension: {path}")
    chosen = next(score for score in result.scores if score.dimensions == result.chosen_dimensions)
    return EvaluationGate(
        dataset_version=result.dataset_version,
        dataset_sha256=result.dataset_sha256,
        corpus_hash=result.corpus_hash,
        result_sha256=hashlib.sha256(contents).hexdigest(),
        metric=result.quality_metric,
        threshold=result.minimum_quality,
        value=chosen.quality_value,
        chosen_dimensions=result.chosen_dimensions,
    )


def _resolve_intents(
    dataset: EvaluationDataset, chunks: tuple[Chunk, ...]
) -> tuple[tuple[frozenset[str], ...], ...]:
    """Resolve every relevance target to the chunk IDs that satisfy it.

    Each target acts as one intent of its query. A target with a section title
    covers the chunk holding that passage (or every chunk of the section when no
    passage index is given); a remedy-level target without a section title covers
    every chunk of the remedy in the target's book, so a query intent stays
    satisfied by any excerpt of the prescribed remedy.
    """
    resolved_queries = []
    for query in dataset.queries:
        intents: list[frozenset[str]] = []
        for target in query.relevant:
            matches = {
                chunk.id
                for chunk in chunks
                if chunk.book_id == target.book_id
                and chunk.remedy_name == target.remedy_name
                and (target.section_title is None or chunk.section_title == target.section_title)
                and (target.passage_index is None or target.passage_index in chunk.passage_indexes)
            }
            if not matches:
                raise CorpusValidationError(
                    f"evaluation query {query.id!r} has an unresolved target: "
                    f"{target.book_id} / {target.remedy_name} / {target.section_title} / "
                    f"{target.passage_index}"
                )
            intents.append(frozenset(matches))
        resolved_queries.append(tuple(intents))
    return tuple(resolved_queries)


def _validate_provider_dimensions(provider: EmbeddingProvider, expected: int) -> None:
    if provider.dimensions != expected:
        raise ValueError(
            f"embedding provider dimension mismatch: expected {expected}, got {provider.dimensions}"
        )


def _ranking_quality(
    rankings: Iterable[Iterable[str]],
    intents_by_query: tuple[tuple[frozenset[str], ...], ...],
    k: int,
    alpha: float,
) -> tuple[RankingQuality, ...]:
    qualities = []
    for ranking, intents in zip(rankings, intents_by_query, strict=True):
        relevant = frozenset().union(*intents)
        ranked_ids = tuple(ranking)[:k]
        ranked_set = set(ranked_ids)
        covered_intents = sum(1 for intent in intents if intent & ranked_set)
        first_relevant_rank = next(
            (rank for rank, chunk_id in enumerate(ranked_ids, start=1) if chunk_id in relevant),
            None,
        )
        qualities.append(
            RankingQuality(
                recall_at_k=covered_intents / len(intents),
                mrr_at_k=0.0 if first_relevant_rank is None else 1 / first_relevant_rank,
                ndcg_at_k=_ndcg_at_k(ranked_ids, relevant, k),
                alpha_ndcg_at_k=_alpha_ndcg_at_k(ranked_ids, intents, k, alpha),
                evidence_precision_at_k=_evidence_precision_at_k(ranked_ids, intents, k, alpha),
            )
        )
    return tuple(qualities)


def _mean_quality(qualities: tuple[RankingQuality, ...]) -> RankingQuality:
    count = len(qualities)
    if count == 0:
        raise CorpusValidationError("cannot average quality over zero queries")
    return RankingQuality(
        recall_at_k=math.fsum(item.recall_at_k for item in qualities) / count,
        mrr_at_k=math.fsum(item.mrr_at_k for item in qualities) / count,
        ndcg_at_k=math.fsum(item.ndcg_at_k for item in qualities) / count,
        alpha_ndcg_at_k=math.fsum(item.alpha_ndcg_at_k for item in qualities) / count,
        evidence_precision_at_k=math.fsum(item.evidence_precision_at_k for item in qualities)
        / count,
    )


def _ndcg_at_k(ranked_ids: Sequence[str], relevant: frozenset[str], k: int) -> float:
    """Binary-relevance nDCG with the standard log2 rank discount."""
    discounts = [1 / math.log2(rank + 1) for rank in range(1, k + 1)]
    dcg = math.fsum(
        discount
        for chunk_id, discount in zip(ranked_ids, discounts, strict=False)
        if chunk_id in relevant
    )
    ideal = math.fsum(discounts[: min(k, len(relevant))])
    return dcg / ideal if ideal else 0.0


def _alpha_ndcg_at_k(
    ranked_ids: Sequence[str],
    intents: tuple[frozenset[str], ...],
    k: int,
    alpha: float,
) -> float:
    """Novelty- and diversity-biased nDCG (Clarke et al., SIGIR 2008).

    Every relevance target is one intent. A chunk covering an intent that
    higher-ranked chunks already covered contributes that intent's gain times
    (1 - alpha) once per previous covering chunk, discounted by log2 rank. The
    normalizer is the greedy ideal alpha-DCG over all relevant chunks.
    """
    intents_by_chunk = _intent_coverage(intents)
    ideal = _greedy_alpha_ideal_dcg(intents_by_chunk, k, alpha)
    if not ideal:
        return 0.0
    seen: dict[int, int] = {}
    dcg = 0.0
    for rank, chunk_id in enumerate(ranked_ids[:k], start=1):
        gain = _discounted_intent_gain(intents_by_chunk, chunk_id, seen, alpha)
        dcg += gain / math.log2(rank + 1)
        _record_intent_coverage(intents_by_chunk, chunk_id, seen)
    return dcg / ideal


def _evidence_precision_at_k(
    ranked_ids: Sequence[str],
    intents: tuple[frozenset[str], ...],
    k: int,
    alpha: float,
) -> float:
    """Novelty-discounted evidence density over the top k slots.

    Every relevance target is one equally weighted intent. A ranked chunk
    contributes the (1 - alpha)-discounted share of the intents it covers that
    higher-ranked chunks have not already satisfied, and the top-k total is
    scaled by 1/k. With one intent and no repeated coverage this is precision@k,
    and every score stays within [0, 1].
    """
    intents_by_chunk = _intent_coverage(intents)
    seen: dict[int, int] = {}
    evidence = 0.0
    for chunk_id in ranked_ids[:k]:
        gain = _discounted_intent_gain(intents_by_chunk, chunk_id, seen, alpha)
        evidence += gain / len(intents)
        _record_intent_coverage(intents_by_chunk, chunk_id, seen)
    return evidence / k


def _intent_coverage(intents: tuple[frozenset[str], ...]) -> dict[str, tuple[int, ...]]:
    coverage: dict[str, list[int]] = {}
    for intent_index, intent_chunks in enumerate(intents):
        for chunk_id in intent_chunks:
            coverage.setdefault(chunk_id, []).append(intent_index)
    return {chunk_id: tuple(indexes) for chunk_id, indexes in coverage.items()}


def _discounted_intent_gain(
    intents_by_chunk: Mapping[str, tuple[int, ...]],
    chunk_id: str,
    seen: Mapping[int, int],
    alpha: float,
) -> float:
    return math.fsum(
        (1.0 - alpha) ** seen.get(intent, 0)
        for intent in intents_by_chunk.get(chunk_id, ())
    )


def _record_intent_coverage(
    intents_by_chunk: Mapping[str, tuple[int, ...]], chunk_id: str, seen: dict[int, int]
) -> None:
    for intent in intents_by_chunk.get(chunk_id, ()):
        seen[intent] = seen.get(intent, 0) + 1


def _greedy_alpha_ideal_dcg(
    intents_by_chunk: Mapping[str, tuple[int, ...]], k: int, alpha: float
) -> float:
    remaining = sorted(intents_by_chunk)
    seen: dict[int, int] = {}
    ideal = 0.0
    for rank in range(1, min(k, len(remaining)) + 1):
        best_id = max(
            remaining,
            key=lambda item: _discounted_intent_gain(intents_by_chunk, item, seen, alpha),
        )
        gain = _discounted_intent_gain(intents_by_chunk, best_id, seen, alpha)
        ideal += gain / math.log2(rank + 1)
        _record_intent_coverage(intents_by_chunk, best_id, seen)
        remaining.remove(best_id)
    return ideal


def _embed_vectors(
    inputs: Iterable[str],
    embed: Callable[[str], Iterable[float]],
    dimensions: int,
    workers: int,
    progress: Callable[[int, int], None] | None,
) -> tuple:
    materialized = tuple(inputs)
    if workers == 1:
        results = map(embed, materialized)
        executor = None
    else:
        executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="openrouter-embedding"
        )
        results = executor.map(embed, materialized, buffersize=workers)
    vectors = []
    try:
        for completed, values in enumerate(results, start=1):
            vectors.append(materialize_float32(values, dimensions))
            if progress is not None:
                progress(completed, len(materialized))
    finally:
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)
    return tuple(vectors)


def _progress_counter(
    progress: Callable[[str], None] | None, label: str
) -> Callable[[int, int], None] | None:
    if progress is None:
        return None

    def report(completed: int, total: int) -> None:
        if completed == total or completed % 500 == 0:
            progress(f"{label}: {completed}/{total}")

    return report
