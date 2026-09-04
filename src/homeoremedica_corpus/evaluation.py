from __future__ import annotations

import hashlib
import math
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
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


class EvaluationTarget(Contract):
    book_id: str
    remedy_name: str
    section_title: str
    passage_index: int | None = Field(default=None, ge=0)


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
    recall_at_k: float = Field(ge=0, le=1)
    mrr_at_k: float = Field(ge=0, le=1)
    quality_value: float = Field(ge=0, le=1)
    passed: bool


class EvaluationResult(Contract):
    evaluation_schema_version: int = 2
    dataset_version: str
    dataset_sha256: str
    corpus_hash: str
    model: str
    document_task_type: str = "RETRIEVAL_DOCUMENT"
    query_task_type: str = "RETRIEVAL_QUERY"
    normalization: str = "l2"
    distance_function: str = "cosine"
    k: int = Field(gt=0)
    quality_metric: QualityMetric
    minimum_quality: float = Field(ge=0, le=1)
    retrieval_strategy: str = "fts5VectorRrf"
    lexical_tokenizer: str = FTS5_TOKENIZER
    candidate_pool_size: int = Field(gt=0)
    reciprocal_rank_constant: int = Field(gt=0)
    lexical_recall_at_k: float = Field(ge=0, le=1)
    lexical_mrr_at_k: float = Field(ge=0, le=1)
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

    relevant_by_query = _resolve_relevance(dataset, materialized_chunks)
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
    lexical_recall, lexical_mrr = _quality_metrics(
        lexical_rankings, relevant_by_query, dataset.k
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
        semantic_recall, semantic_mrr = _quality_metrics(
            semantic_rankings, relevant_by_query, dataset.k
        )
        recall_at_k, mrr_at_k = _quality_metrics(
            fused_rankings, relevant_by_query, dataset.k
        )
        quality_value = recall_at_k if dataset.quality_metric == "recallAtK" else mrr_at_k
        scores.append(
            DimensionScore(
                dimensions=dimension,
                semantic_recall_at_k=semantic_recall,
                semantic_mrr_at_k=semantic_mrr,
                recall_at_k=recall_at_k,
                mrr_at_k=mrr_at_k,
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
        quality_metric=dataset.quality_metric,
        minimum_quality=dataset.minimum_quality,
        candidate_pool_size=retrieval.candidate_pool_size,
        reciprocal_rank_constant=retrieval.reciprocal_rank_constant,
        lexical_recall_at_k=lexical_recall,
        lexical_mrr_at_k=lexical_mrr,
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


def _resolve_relevance(
    dataset: EvaluationDataset, chunks: tuple[Chunk, ...]
) -> tuple[frozenset[str], ...]:
    resolved_queries = []
    for query in dataset.queries:
        resolved: set[str] = set()
        for target in query.relevant:
            matches = {
                chunk.id
                for chunk in chunks
                if chunk.book_id == target.book_id
                and chunk.remedy_name == target.remedy_name
                and chunk.section_title == target.section_title
                and (target.passage_index is None or target.passage_index in chunk.passage_indexes)
            }
            if not matches:
                raise CorpusValidationError(
                    f"evaluation query {query.id!r} has an unresolved target: "
                    f"{target.book_id} / {target.remedy_name} / {target.section_title} / "
                    f"{target.passage_index}"
                )
            resolved.update(matches)
        resolved_queries.append(frozenset(resolved))
    return tuple(resolved_queries)


def _validate_provider_dimensions(provider: EmbeddingProvider, expected: int) -> None:
    if provider.dimensions != expected:
        raise ValueError(
            f"embedding provider dimension mismatch: expected {expected}, got {provider.dimensions}"
        )


def _quality_metrics(
    rankings: Iterable[Iterable[str]],
    relevant_by_query: tuple[frozenset[str], ...],
    k: int,
) -> tuple[float, float]:
    recalls = []
    reciprocal_ranks = []
    for ranking, relevant in zip(rankings, relevant_by_query, strict=True):
        ranked_ids = tuple(ranking)[:k]
        recalls.append(len(set(ranked_ids) & relevant) / len(relevant))
        first_relevant_rank = next(
            (index for index, chunk_id in enumerate(ranked_ids, start=1) if chunk_id in relevant),
            None,
        )
        reciprocal_ranks.append(0.0 if first_relevant_rank is None else 1 / first_relevant_rank)
    return (
        math.fsum(recalls) / len(recalls),
        math.fsum(reciprocal_ranks) / len(reciprocal_ranks),
    )


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
        executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="vertex-embedding")
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
