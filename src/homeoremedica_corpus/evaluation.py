from __future__ import annotations

import hashlib
import math
import os
import struct
import tempfile
from array import array
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal, cast

from pydantic import Field, model_validator

from homeoremedica_corpus.chunking import Chunk
from homeoremedica_corpus.contracts import Contract, EvaluationGate, canonical_json_bytes
from homeoremedica_corpus.embeddings import (
    EMBEDDING_BATCH_SIZE,
    EmbeddingProvider,
    preflight_embedding_inputs,
)
from homeoremedica_corpus.retrieval import (
    DEFAULT_HYBRID_RETRIEVAL_POLICY,
    FTS5_TOKENIZER,
    HybridRetrievalPolicy,
    ScoredCandidate,
    lexical_content_terms,
    materialize_float32,
    normalized_remedy_name,
    rank_lexical_queries,
    rank_semantic_queries,
    reciprocal_rank_fusion,
    score_lexical_queries,
    score_semantic_queries,
)
from homeoremedica_corpus.sources import CorpusValidationError

QualityMetric = Literal["recallAtK", "mrrAtK"]
RankingUnit = Literal["chunk", "remedy", "globalRemedy"]
FusionStrategy = Literal["rrf", "normalizedScore"]
RemedyNameNormalization = Literal["exact", "nfkcCasefoldWhitespace"]
LexicalQueryMode = Literal["raw", "contentTerms"]

# Clarke, Kolla, Cormack, Vechtomova, Ashkan, Buettcher, and MacKinnon (SIGIR 2008):
# each time a ranked chunk covers an intent a higher ranked chunk already covered,
# the gain that intent contributes is multiplied by (1 - alpha).
ALPHA_NOVELTY_DISCOUNT = 0.5
SCORE_FUSION_EXPONENT = 2.0
SCORE_FUSION_NORMALIZATION = "perRankingMinMax"
RANKING_CACHE_MAGIC = b"HOMEORANK1\n"


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
    query: str | None = None
    symptoms: tuple[str, ...] | None = Field(default=None, min_length=1)
    relevant: tuple[EvaluationTarget, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_query_shape(self) -> EvaluationQuery:
        legacy = self.query is not None
        symptom_query = self.symptoms is not None
        if legacy == symptom_query:
            raise ValueError("evaluation query must contain either query or symptoms")
        if legacy:
            if not self.query or not self.query.strip():
                raise ValueError("evaluation query text must be non-empty")
        elif self.symptoms is None or any(not symptom.strip() for symptom in self.symptoms):
            raise ValueError("evaluation symptoms must be non-empty")
        return self

    @property
    def semantic_inputs(self) -> tuple[str, ...]:
        if self.query is not None:
            return (self.query,)
        assert self.symptoms is not None
        return self.symptoms

    @property
    def lexical_inputs(self) -> tuple[str, ...]:
        if self.query is not None:
            return (self.query,)
        assert self.symptoms is not None
        return self.symptoms


class EvaluationDataset(Contract):
    version: str
    k: int = Field(gt=0)
    ranking_unit: RankingUnit = "chunk"
    fusion_strategy: FusionStrategy = "rrf"
    remedy_name_normalization: RemedyNameNormalization = "exact"
    lexical_query_mode: LexicalQueryMode = "raw"
    semantic_query_instruction: str | None = Field(default=None, min_length=1)
    candidate_pool_size: int = Field(default=100, gt=0)
    quality_metric: QualityMetric
    minimum_quality: float = Field(ge=0, le=1)
    queries: tuple[EvaluationQuery, ...] = Field(min_length=1)

    @property
    def semantic_input_groups(self) -> tuple[tuple[str, ...], ...]:
        return tuple(
            tuple(
                f"Instruct: {self.semantic_query_instruction}\nQuery:{text}"
                if self.semantic_query_instruction is not None
                else text
                for text in query.semantic_inputs
            )
            for query in self.queries
        )

    @model_validator(mode="after")
    def validate_queries(self) -> EvaluationDataset:
        if (
            self.semantic_query_instruction is not None
            and not self.semantic_query_instruction.strip()
        ):
            raise ValueError("semantic query instruction must be non-empty")
        identifiers = [query.id for query in self.queries]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("evaluation query IDs must be unique")
        if any(not query.id.strip() for query in self.queries):
            raise ValueError("evaluation query IDs must be non-empty")
        if self.ranking_unit != "chunk" and any(
            target.section_title is not None for query in self.queries for target in query.relevant
        ):
            raise ValueError("non-chunk ranking requires remedy-level relevance targets")
        if self.ranking_unit == "globalRemedy" and any(
            len(query.relevant)
            != len({
                _remedy_identity(target.remedy_name, self.remedy_name_normalization)
                for target in query.relevant
            })
            for query in self.queries
        ):
            raise ValueError("global remedy targets must have unique remedy names per query")
        if self.remedy_name_normalization != "exact" and self.ranking_unit != "globalRemedy":
            raise ValueError("remedy name normalization requires global remedy ranking")
        if self.fusion_strategy == "normalizedScore" and self.ranking_unit != "globalRemedy":
            raise ValueError("normalized score fusion requires global remedy ranking")
        return self


class DimensionScore(Contract):
    dimensions: int = Field(gt=0)
    semantic_candidate_recall_at_pool: float = Field(ge=0, le=1)
    semantic_recall_at_k: float = Field(ge=0, le=1)
    semantic_mrr_at_k: float = Field(ge=0, le=1)
    semantic_ndcg_at_k: float = Field(ge=0, le=1)
    semantic_alpha_ndcg_at_k: float = Field(ge=0, le=1)
    semantic_evidence_precision_at_k: float = Field(ge=0, le=1)
    candidate_recall_at_pool: float = Field(ge=0, le=1)
    recall_at_k: float = Field(ge=0, le=1)
    mrr_at_k: float = Field(ge=0, le=1)
    ndcg_at_k: float = Field(ge=0, le=1)
    alpha_ndcg_at_k: float = Field(ge=0, le=1)
    evidence_precision_at_k: float = Field(ge=0, le=1)
    quality_value: float = Field(ge=0, le=1)
    passed: bool


class EvaluationResult(Contract):
    evaluation_schema_version: int = 9
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
    ranking_unit: RankingUnit = "chunk"
    fusion_strategy: FusionStrategy = "rrf"
    remedy_name_normalization: RemedyNameNormalization = "exact"
    lexical_query_mode: LexicalQueryMode = "raw"
    semantic_query_instruction: str | None = Field(default=None, min_length=1)
    retrieval_strategy: str
    lexical_tokenizer: str = FTS5_TOKENIZER
    candidate_pool_size: int = Field(gt=0)
    reciprocal_rank_constant: int | None = Field(default=None, gt=0)
    score_fusion_normalization: str | None = None
    score_fusion_exponent: float | None = Field(default=None, gt=0)
    lexical_candidate_recall_at_pool: float = Field(ge=0, le=1)
    lexical_recall_at_k: float = Field(ge=0, le=1)
    lexical_mrr_at_k: float = Field(ge=0, le=1)
    lexical_ndcg_at_k: float = Field(ge=0, le=1)
    lexical_alpha_ndcg_at_k: float = Field(ge=0, le=1)
    lexical_evidence_precision_at_k: float = Field(ge=0, le=1)
    scores: tuple[DimensionScore, ...] = Field(min_length=1)
    chosen_dimensions: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_fusion_metadata(self) -> EvaluationResult:
        if self.fusion_strategy == "normalizedScore":
            if (
                self.reciprocal_rank_constant is not None
                or self.score_fusion_normalization is None
                or self.score_fusion_exponent is None
            ):
                raise ValueError("normalized score results require only score fusion metadata")
        elif (
            self.reciprocal_rank_constant is None
            or self.score_fusion_normalization is not None
            or self.score_fusion_exponent is not None
        ):
            raise ValueError("RRF results require only a reciprocal rank constant")
        return self


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
    embedding_cache_directory: Path | None = None,
    workers: int = 1,
    progress: Callable[[str], None] | None = None,
) -> EvaluationResult:
    materialized_chunks = tuple(chunks)
    if not materialized_chunks:
        raise CorpusValidationError("cannot evaluate an empty corpus")
    if not dimensions or len(set(dimensions)) != len(dimensions) or any(d <= 0 for d in dimensions):
        raise ValueError("evaluation requires unique positive dimensions")

    intents_by_query = _resolve_intents(dataset, materialized_chunks)
    maximum_dimensions = max(dimensions)
    if workers <= 0:
        raise ValueError("embedding workers must be positive")
    query_input_groups = dataset.semantic_input_groups
    query_group_sizes = tuple(len(group) for group in query_input_groups)
    query_inputs = tuple(text for group in query_input_groups for text in group)
    candidate_limit = min(len(materialized_chunks), max(dataset.k, dataset.candidate_pool_size))
    chunk_ids = tuple(chunk.id for chunk in materialized_chunks)
    semantic_cache_paths = {
        dimension: _ranking_cache_path(
            embedding_cache_directory,
            "semantic",
            corpus_hash,
            model,
            dimension,
            candidate_limit,
            query_inputs,
            retrieval,
        )
        for dimension in dimensions
    }
    scored_rankings_cached = dataset.fusion_strategy == "normalizedScore" and all(
        path is not None and path.is_file() for path in semantic_cache_paths.values()
    )
    document_vectors: tuple[Sequence[float], ...] = ()
    query_vectors: tuple[Sequence[float], ...] = ()
    if scored_rankings_cached:
        if progress is not None:
            progress("reusing cached semantic candidates; skipped embedding preparation")
    else:
        provider = provider_for_dimensions(maximum_dimensions)
        _validate_provider_dimensions(provider, maximum_dimensions)
        preflight_embedding_inputs(
            materialized_chunks,
            provider,
            model_input_limit,
            workers=workers,
            progress=_progress_counter(progress, "counted embedding tokens"),
        )
        document_inputs = tuple(chunk.embedding_text for chunk in materialized_chunks)
        document_vectors = _embed_provider_vectors(
            document_inputs,
            provider,
            "embed_document",
            "embed_documents",
            maximum_dimensions,
            workers,
            _progress_counter(progress, "embedded documents"),
            cache_path=_embedding_cache_path(
                embedding_cache_directory,
                "documents",
                model,
                maximum_dimensions,
                document_inputs,
            ),
        )
        query_vectors = _embed_provider_vectors(
            query_inputs,
            provider,
            "embed_query",
            "embed_queries",
            maximum_dimensions,
            workers,
            _progress_counter(progress, "embedded queries"),
            cache_path=_embedding_cache_path(
                embedding_cache_directory,
                "queries",
                model,
                maximum_dimensions,
                query_inputs,
            ),
        )
    chunk_ranking_ids = {
        chunk.id: _ranking_id(chunk, dataset.ranking_unit, dataset.remedy_name_normalization)
        for chunk in materialized_chunks
    }
    lexical_input_groups = tuple(query.lexical_inputs for query in dataset.queries)
    lexical_inputs = tuple(
        lexical_content_terms(text) if dataset.lexical_query_mode == "contentTerms" else text
        for group in lexical_input_groups
        for text in group
    )
    lexical_unit_scores: tuple[tuple[ScoredCandidate, ...], ...] = ()
    lexical_unit_rankings: tuple[tuple[str, ...], ...] = ()
    if dataset.fusion_strategy == "normalizedScore":
        flat_lexical_scores = _load_or_compute_scored_rankings(
            _ranking_cache_path(
                embedding_cache_directory,
                "lexical",
                corpus_hash,
                model,
                maximum_dimensions,
                candidate_limit,
                lexical_inputs,
                retrieval,
            ),
            chunk_ids,
            len(lexical_inputs),
            lambda: score_lexical_queries(
                materialized_chunks,
                lexical_inputs,
                limit=candidate_limit,
                policy=retrieval,
            ),
            progress,
            "lexical candidates",
        )
        lexical_unit_scores = _scored_rankings_for_unit(flat_lexical_scores, chunk_ranking_ids)
        lexical_rankings = _aggregate_scored_query_rankings(
            lexical_unit_scores,
            query_group_sizes,
            candidate_limit,
            SCORE_FUSION_EXPONENT,
        )
    else:
        flat_lexical_rankings = rank_lexical_queries(
            materialized_chunks,
            lexical_inputs,
            limit=candidate_limit,
            policy=retrieval,
        )
        lexical_unit_rankings = _rankings_for_unit(
            flat_lexical_rankings, dataset.ranking_unit, chunk_ranking_ids
        )
        lexical_rankings = _aggregate_query_rankings(
            lexical_unit_rankings,
            query_group_sizes,
            candidate_limit,
            retrieval.reciprocal_rank_constant,
        )
    lexical_quality = _mean_quality(
        _ranking_quality(lexical_rankings, intents_by_query, dataset.k, ALPHA_NOVELTY_DISCOUNT)
    )
    lexical_candidate_recall = _mean_recall(lexical_rankings, intents_by_query, candidate_limit)

    scores = []
    for dimension in dimensions:
        semantic_unit_rankings: tuple[tuple[str, ...], ...] = ()
        fused_rankings: tuple[tuple[str, ...], ...] = ()
        if dataset.fusion_strategy == "normalizedScore":
            flat_semantic_scores = _load_or_compute_scored_rankings(
                semantic_cache_paths[dimension],
                chunk_ids,
                len(query_inputs),
                lambda dimension=dimension: score_semantic_queries(
                    chunk_ids,
                    document_vectors,
                    query_vectors,
                    dimensions=dimension,
                    limit=candidate_limit,
                ),
                progress,
                f"{dimension}-dimension semantic candidates",
            )
            semantic_unit_scores = _scored_rankings_for_unit(
                flat_semantic_scores, chunk_ranking_ids
            )
            semantic_rankings = _aggregate_scored_query_rankings(
                semantic_unit_scores,
                query_group_sizes,
                candidate_limit,
                SCORE_FUSION_EXPONENT,
            )
            interleaved_scores = tuple(
                ranking
                for semantic, lexical in zip(semantic_unit_scores, lexical_unit_scores, strict=True)
                for ranking in (semantic, lexical)
            )
            fused_rankings = _aggregate_scored_query_rankings(
                interleaved_scores,
                tuple(size * 2 for size in query_group_sizes),
                candidate_limit,
                SCORE_FUSION_EXPONENT,
            )
        else:
            flat_semantic_rankings = rank_semantic_queries(
                chunk_ids,
                document_vectors,
                query_vectors,
                dimensions=dimension,
                limit=candidate_limit,
            )
            semantic_unit_rankings = _rankings_for_unit(
                flat_semantic_rankings, dataset.ranking_unit, chunk_ranking_ids
            )
            semantic_rankings = _aggregate_query_rankings(
                semantic_unit_rankings,
                query_group_sizes,
                candidate_limit,
                retrieval.reciprocal_rank_constant,
            )
        if dataset.fusion_strategy == "rrf" and dataset.ranking_unit != "chunk":
            flat_fused_rankings = tuple(
                reciprocal_rank_fusion(
                    (semantic, lexical), rank_constant=retrieval.reciprocal_rank_constant
                )[:candidate_limit]
                for semantic, lexical in zip(
                    semantic_unit_rankings, lexical_unit_rankings, strict=True
                )
            )
            fused_rankings = _aggregate_query_rankings(
                flat_fused_rankings,
                query_group_sizes,
                candidate_limit,
                retrieval.reciprocal_rank_constant,
            )
        elif dataset.fusion_strategy == "rrf":
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
        semantic_candidate_recall = _mean_recall(
            semantic_rankings, intents_by_query, candidate_limit
        )
        fused_candidate_recall = _mean_recall(fused_rankings, intents_by_query, candidate_limit)
        quality_value = (
            fused_quality.recall_at_k
            if dataset.quality_metric == "recallAtK"
            else fused_quality.mrr_at_k
        )
        scores.append(
            DimensionScore(
                dimensions=dimension,
                semantic_candidate_recall_at_pool=semantic_candidate_recall,
                semantic_recall_at_k=semantic_quality.recall_at_k,
                semantic_mrr_at_k=semantic_quality.mrr_at_k,
                semantic_ndcg_at_k=semantic_quality.ndcg_at_k,
                semantic_alpha_ndcg_at_k=semantic_quality.alpha_ndcg_at_k,
                semantic_evidence_precision_at_k=semantic_quality.evidence_precision_at_k,
                candidate_recall_at_pool=fused_candidate_recall,
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
        ranking_unit=dataset.ranking_unit,
        fusion_strategy=dataset.fusion_strategy,
        remedy_name_normalization=dataset.remedy_name_normalization,
        lexical_query_mode=dataset.lexical_query_mode,
        semantic_query_instruction=dataset.semantic_query_instruction,
        retrieval_strategy=_retrieval_strategy(dataset.ranking_unit, dataset.fusion_strategy),
        candidate_pool_size=dataset.candidate_pool_size,
        reciprocal_rank_constant=(
            retrieval.reciprocal_rank_constant if dataset.fusion_strategy == "rrf" else None
        ),
        score_fusion_normalization=(
            SCORE_FUSION_NORMALIZATION if dataset.fusion_strategy == "normalizedScore" else None
        ),
        score_fusion_exponent=(
            SCORE_FUSION_EXPONENT if dataset.fusion_strategy == "normalizedScore" else None
        ),
        lexical_candidate_recall_at_pool=lexical_candidate_recall,
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
    """Resolve every relevance target to the ranking IDs that satisfy it.

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
            matching_chunks = {
                chunk
                for chunk in chunks
                if chunk.book_id == target.book_id
                and chunk.remedy_name == target.remedy_name
                and (target.section_title is None or chunk.section_title == target.section_title)
                and (target.passage_index is None or target.passage_index in chunk.passage_indexes)
            }
            if not matching_chunks:
                raise CorpusValidationError(
                    f"evaluation query {query.id!r} has an unresolved target: "
                    f"{target.book_id} / {target.remedy_name} / {target.section_title} / "
                    f"{target.passage_index}"
                )
            matches = {
                _ranking_id(chunk, dataset.ranking_unit, dataset.remedy_name_normalization)
                for chunk in matching_chunks
            }
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


def _mean_recall(
    rankings: Iterable[Iterable[str]],
    intents_by_query: tuple[tuple[frozenset[str], ...], ...],
    k: int,
) -> float:
    recalls = []
    for ranking, intents in zip(rankings, intents_by_query, strict=True):
        ranked_set = set(tuple(ranking)[:k])
        recalls.append(sum(1 for intent in intents if intent & ranked_set) / len(intents))
    return math.fsum(recalls) / len(recalls)


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
        (1.0 - alpha) ** seen.get(intent, 0) for intent in intents_by_chunk.get(chunk_id, ())
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


def _aggregate_query_rankings(
    flat_rankings: Sequence[Sequence[str]],
    group_sizes: Sequence[int],
    limit: int,
    rank_constant: int,
) -> tuple[tuple[str, ...], ...]:
    if sum(group_sizes) != len(flat_rankings):
        raise RuntimeError("query ranking count does not match the symptom groups")
    aggregated = []
    start = 0
    for size in group_sizes:
        end = start + size
        aggregated.append(
            reciprocal_rank_fusion(flat_rankings[start:end], rank_constant=rank_constant)[:limit]
        )
        start = end
    return tuple(aggregated)


def _scored_rankings_for_unit(
    rankings: Sequence[Sequence[ScoredCandidate]],
    chunk_ranking_ids: Mapping[str, str],
) -> tuple[tuple[ScoredCandidate, ...], ...]:
    collapsed_rankings = []
    for ranking in rankings:
        normalized = _min_max_normalize(ranking)
        best_scores: dict[str, float] = {}
        best_ranks: dict[str, int] = {}
        for rank, candidate in enumerate(normalized, start=1):
            ranking_id = chunk_ranking_ids[candidate.chunk_id]
            best_scores[ranking_id] = max(candidate.score, best_scores.get(ranking_id, -math.inf))
            best_ranks[ranking_id] = min(rank, best_ranks.get(ranking_id, rank))
        collapsed_rankings.append(
            tuple(
                ScoredCandidate(chunk_id=ranking_id, score=best_scores[ranking_id])
                for ranking_id in sorted(
                    best_scores,
                    key=lambda item: (-best_scores[item], best_ranks[item], item),
                )
            )
        )
    return tuple(collapsed_rankings)


def _min_max_normalize(ranking: Sequence[ScoredCandidate]) -> tuple[ScoredCandidate, ...]:
    if not ranking:
        return ()
    minimum = min(candidate.score for candidate in ranking)
    maximum = max(candidate.score for candidate in ranking)
    scale = maximum - minimum
    if math.isclose(scale, 0.0, abs_tol=1e-12):
        return tuple(ScoredCandidate(candidate.chunk_id, 1.0) for candidate in ranking)
    return tuple(
        ScoredCandidate(
            candidate.chunk_id,
            min(1.0, max(0.0, (candidate.score - minimum) / scale)),
        )
        for candidate in ranking
    )


def _aggregate_scored_query_rankings(
    flat_rankings: Sequence[Sequence[ScoredCandidate]],
    group_sizes: Sequence[int],
    limit: int,
    exponent: float,
) -> tuple[tuple[str, ...], ...]:
    if sum(group_sizes) != len(flat_rankings):
        raise RuntimeError("query ranking count does not match the symptom groups")
    aggregated = []
    start = 0
    for size in group_sizes:
        end = start + size
        aggregated.append(_normalized_score_fusion(flat_rankings[start:end], exponent)[:limit])
        start = end
    return tuple(aggregated)


def _normalized_score_fusion(
    rankings: Sequence[Sequence[ScoredCandidate]], exponent: float
) -> tuple[str, ...]:
    if exponent <= 0 or not math.isfinite(exponent):
        raise ValueError("score fusion exponent must be finite and positive")
    scores: dict[str, float] = {}
    best_ranks: dict[str, int] = {}
    for ranking in rankings:
        for rank, candidate in enumerate(ranking, start=1):
            scores[candidate.chunk_id] = scores.get(candidate.chunk_id, 0.0) + (
                candidate.score**exponent
            )
            best_ranks[candidate.chunk_id] = min(rank, best_ranks.get(candidate.chunk_id, rank))
    return tuple(sorted(scores, key=lambda item: (-scores[item], best_ranks[item], item)))


def _rankings_for_unit(
    rankings: Sequence[Sequence[str]],
    ranking_unit: RankingUnit,
    chunk_ranking_ids: Mapping[str, str],
) -> tuple[tuple[str, ...], ...]:
    if ranking_unit == "chunk":
        return tuple(tuple(ranking) for ranking in rankings)
    remedy_rankings = []
    for ranking in rankings:
        remedies = dict.fromkeys(chunk_ranking_ids[chunk_id] for chunk_id in ranking)
        remedy_rankings.append(tuple(remedies))
    return tuple(remedy_rankings)


def _remedy_identity(name: str, normalization: RemedyNameNormalization) -> str:
    return normalized_remedy_name(name) if normalization == "nfkcCasefoldWhitespace" else name


def _ranking_id(
    chunk: Chunk,
    ranking_unit: RankingUnit,
    normalization: RemedyNameNormalization = "exact",
) -> str:
    if ranking_unit == "chunk":
        return chunk.id
    if ranking_unit == "remedy":
        return f"{chunk.book_id}\x1f{chunk.remedy_name}"
    return _remedy_identity(chunk.remedy_name, normalization)


def _retrieval_strategy(ranking_unit: RankingUnit, fusion_strategy: FusionStrategy) -> str:
    if fusion_strategy == "normalizedScore":
        return "symptomGlobalRemedyNormalizedScoreFusion"
    if ranking_unit == "chunk":
        return "symptomRrfThenFts5VectorRrf"
    if ranking_unit == "remedy":
        return "symptomRemedyRrf"
    return "symptomGlobalRemedyRrf"


def _load_or_compute_scored_rankings(
    cache_path: Path | None,
    chunk_ids: Sequence[str],
    expected_queries: int,
    compute: Callable[[], tuple[tuple[ScoredCandidate, ...], ...]],
    progress: Callable[[str], None] | None,
    label: str,
) -> tuple[tuple[ScoredCandidate, ...], ...]:
    if cache_path is not None and cache_path.is_file():
        rankings = _load_scored_ranking_cache(cache_path, chunk_ids, expected_queries)
        if progress is not None:
            progress(f"loaded {label} from cache")
        return rankings
    rankings = compute()
    if len(rankings) != expected_queries:
        raise RuntimeError(f"{label} count does not match the query inputs")
    if cache_path is not None:
        _store_scored_ranking_cache(cache_path, chunk_ids, rankings)
        if progress is not None:
            progress(f"cached {label}")
    return rankings


def _ranking_cache_path(
    directory: Path | None,
    role: str,
    corpus_hash: str,
    model: str,
    dimensions: int,
    candidate_limit: int,
    inputs: Sequence[str],
    retrieval: HybridRetrievalPolicy,
) -> Path | None:
    if directory is None:
        return None
    digest = hashlib.sha256()
    digest.update(b"homeoremedica-ranking-cache-v1\0")
    digest.update(role.encode("utf-8"))
    digest.update(corpus_hash.encode("ascii"))
    digest.update(model.encode("utf-8"))
    digest.update(dimensions.to_bytes(4, "big"))
    digest.update(candidate_limit.to_bytes(4, "big"))
    digest.update(FTS5_TOKENIZER.encode("utf-8"))
    digest.update(
        struct.pack(
            "<iddd",
            retrieval.reciprocal_rank_constant,
            retrieval.text_weight,
            retrieval.remedy_weight,
            retrieval.section_weight,
        )
    )
    for text in inputs:
        encoded = text.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    return directory / f"{role}-rankings-{dimensions}-{digest.hexdigest()}.bin"


def _load_scored_ranking_cache(
    path: Path, chunk_ids: Sequence[str], expected_queries: int
) -> tuple[tuple[ScoredCandidate, ...], ...]:
    header = struct.Struct("<I")
    item = struct.Struct("<Id")
    rankings = []
    with path.open("rb") as source:
        if source.read(len(RANKING_CACHE_MAGIC)) != RANKING_CACHE_MAGIC:
            raise RuntimeError(f"scored ranking cache has an invalid header: {path}")
        query_count = header.unpack(_read_cache_bytes(source, header.size, path))[0]
        if query_count != expected_queries:
            raise RuntimeError(f"scored ranking cache has an invalid query count: {path}")
        for _ in range(query_count):
            result_count = header.unpack(_read_cache_bytes(source, header.size, path))[0]
            ranking = []
            for _ in range(result_count):
                raw_chunk_index, raw_score = item.unpack(_read_cache_bytes(source, item.size, path))
                chunk_index = int(raw_chunk_index)
                score = float(raw_score)
                if chunk_index >= len(chunk_ids) or not math.isfinite(score):
                    raise RuntimeError(f"scored ranking cache contains invalid data: {path}")
                ranking.append(ScoredCandidate(chunk_id=chunk_ids[chunk_index], score=score))
            rankings.append(tuple(ranking))
        if source.read(1):
            raise RuntimeError(f"scored ranking cache has trailing data: {path}")
    return tuple(rankings)


def _read_cache_bytes(source: BinaryIO, size: int, path: Path) -> bytes:
    contents = source.read(size)
    if len(contents) != size:
        raise RuntimeError(f"scored ranking cache is truncated: {path}")
    return contents


def _store_scored_ranking_cache(
    path: Path,
    chunk_ids: Sequence[str],
    rankings: Sequence[Sequence[ScoredCandidate]],
) -> None:
    chunk_indexes = {chunk_id: index for index, chunk_id in enumerate(chunk_ids)}
    if len(chunk_indexes) != len(chunk_ids):
        raise RuntimeError("cannot cache scored rankings with duplicate chunk IDs")
    header = struct.Struct("<I")
    item = struct.Struct("<Id")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(RANKING_CACHE_MAGIC)
            temporary.write(header.pack(len(rankings)))
            for ranking in rankings:
                temporary.write(header.pack(len(ranking)))
                for candidate in ranking:
                    try:
                        chunk_index = chunk_indexes[candidate.chunk_id]
                    except KeyError as error:
                        raise RuntimeError(
                            f"cannot cache unknown chunk ID: {candidate.chunk_id}"
                        ) from error
                    temporary.write(item.pack(chunk_index, candidate.score))
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _embed_provider_vectors(
    inputs: Iterable[str],
    provider: EmbeddingProvider,
    single_method: str,
    batch_method: str,
    dimensions: int,
    workers: int,
    progress: Callable[[int, int], None] | None,
    *,
    cache_path: Path | None = None,
) -> tuple:
    materialized = tuple(inputs)
    if cache_path is not None and cache_path.is_file():
        return _load_embedding_cache(cache_path, len(materialized), dimensions, progress)

    batch_embed = getattr(provider, batch_method, None)
    if not callable(batch_embed):
        vectors = _embed_vectors(
            materialized,
            getattr(provider, single_method),
            dimensions,
            workers,
            progress,
        )
    else:
        typed_batch_embed = cast(Callable[[Sequence[str]], Iterable[Iterable[float]]], batch_embed)
        batches = tuple(
            materialized[start : start + EMBEDDING_BATCH_SIZE]
            for start in range(0, len(materialized), EMBEDDING_BATCH_SIZE)
        )
        if workers == 1:
            results = map(typed_batch_embed, batches)
            executor = None
        else:
            executor = ThreadPoolExecutor(
                max_workers=workers, thread_name_prefix="openrouter-embedding"
            )
            results = executor.map(typed_batch_embed, batches, buffersize=workers)
        materialized_results = []
        completed = 0
        try:
            for batch, batch_vectors in zip(batches, results, strict=True):
                materialized_vectors = tuple(batch_vectors)
                if len(materialized_vectors) != len(batch):
                    raise RuntimeError(
                        "Embedding provider returned a different number of vectors than inputs"
                    )
                for values in materialized_vectors:
                    materialized_results.append(materialize_float32(values, dimensions))
                    completed += 1
                    if progress is not None:
                        progress(completed, len(materialized))
        finally:
            if executor is not None:
                executor.shutdown(wait=True, cancel_futures=True)
        vectors = tuple(materialized_results)
    if cache_path is not None:
        _store_embedding_cache(cache_path, vectors)
    return vectors


def _embedding_cache_path(
    directory: Path | None,
    role: str,
    model: str,
    dimensions: int,
    inputs: Sequence[str],
) -> Path | None:
    if directory is None:
        return None
    digest = hashlib.sha256()
    digest.update(b"homeoremedica-embedding-cache-v1\0")
    digest.update(model.encode("utf-8"))
    digest.update(dimensions.to_bytes(4, "big"))
    for text in inputs:
        encoded = text.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    return directory / f"{role}-{dimensions}-{digest.hexdigest()}.f32"


def _load_embedding_cache(
    path: Path,
    count: int,
    dimensions: int,
    progress: Callable[[int, int], None] | None,
) -> tuple[array[float], ...]:
    expected_bytes = count * dimensions * array("f").itemsize
    if path.stat().st_size != expected_bytes:
        raise RuntimeError(f"embedding cache has an invalid byte size: {path}")
    vectors = []
    with path.open("rb") as source:
        for completed in range(1, count + 1):
            vector = array("f")
            vector.fromfile(source, dimensions)
            vectors.append(vector)
            if progress is not None:
                progress(completed, count)
    return tuple(vectors)


def _store_embedding_cache(path: Path, vectors: Sequence[array[float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            for vector in vectors:
                vector.tofile(temporary)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


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
