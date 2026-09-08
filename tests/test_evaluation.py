from __future__ import annotations

import json
import math
from dataclasses import dataclass, replace
from pathlib import Path

import pytest
from pydantic import ValidationError

from homeoremedica_corpus.chunking import chunk_book, corpus_hash
from homeoremedica_corpus.evaluation import (
    EvaluationDataset,
    EvaluationQuery,
    EvaluationTarget,
    _aggregate_query_rankings,
    _aggregate_scored_query_rankings,
    _load_scored_ranking_cache,
    _ranking_quality,
    _rankings_for_unit,
    _resolve_intents,
    _scored_rankings_for_unit,
    _store_scored_ranking_cache,
    record_evaluation,
    run_dimension_evaluation,
)
from homeoremedica_corpus.retrieval import ScoredCandidate
from homeoremedica_corpus.sources import Book, CorpusValidationError, Remedy, Section


def books() -> tuple[Book, ...]:
    return tuple(
        Book(
            book_id=book_id,
            title=f"Book {book_id}",
            author=None,
            source_path=Path(f"{book_id}.json"),
            source_sha256=marker * 64,
            remedies=(
                Remedy(
                    name="REMEDY",
                    sections=(Section(title="Mind", passages=(f"{marker} evidence",)),),
                ),
            ),
        )
        for book_id, marker in (("alpha", "a"), ("beta", "b"))
    )


@dataclass
class EvaluationProvider:
    dimensions: int

    def __post_init__(self) -> None:
        self.events: list[str] = []

    def count_tokens(self, text: str) -> int:
        self.events.append("count")
        return 1

    def embed_document(self, text: str) -> tuple[float, ...]:
        self.events.append("document")
        is_alpha = "Text: a evidence" in text
        if self.dimensions == 2:
            return (0.0, 1.0) if is_alpha else (1.0, 0.0)
        return (0.0, 1.0, 1.0) if is_alpha else (1.0, 0.0, -1.0)

    def embed_query(self, text: str) -> tuple[float, ...]:
        self.events.append("query")
        return (1.0, 0.0) if self.dimensions == 2 else (1.0, 0.0, 1.0)


def dataset(target_book: str = "alpha") -> EvaluationDataset:
    return EvaluationDataset(
        version="v1",
        k=1,
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                query="find alpha",
                relevant=(
                    EvaluationTarget(
                        book_id=target_book,
                        remedy_name="REMEDY",
                        section_title="Mind",
                        passage_index=0,
                    ),
                ),
            ),
        ),
    )


def test_compares_dimensions_and_selects_the_smallest_passing_result(tmp_path: Path) -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    providers: dict[int, EvaluationProvider] = {}

    def provider_for(dimensions: int) -> EvaluationProvider:
        provider = EvaluationProvider(dimensions)
        providers[dimensions] = provider
        return provider

    result = run_dimension_evaluation(
        dataset(),
        corpus_chunks,
        provider_for,
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(2, 3),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="d" * 64,
    )

    assert result.chosen_dimensions == 3
    assert [(score.dimensions, score.recall_at_k, score.passed) for score in result.scores] == [
        (2, 0.0, False),
        (3, 1.0, True),
    ]
    assert set(providers) == {3}
    assert providers[3].events == ["count", "count", "document", "document", "query"]
    assert result.lexical_recall_at_k == 0.0
    assert result.scores[0].semantic_recall_at_k == 0.0
    assert result.scores[1].semantic_recall_at_k == 1.0
    assert result.evaluation_schema_version == 9
    assert result.retrieval_strategy == "symptomRrfThenFts5VectorRrf"
    assert result.alpha_discount == 0.5
    assert result.lexical_mrr_at_k == 0.0
    assert result.lexical_ndcg_at_k == 0.0
    assert result.lexical_alpha_ndcg_at_k == 0.0
    assert result.lexical_evidence_precision_at_k == 0.0

    failing, passing = result.scores
    assert failing.dimensions == 2
    assert (failing.recall_at_k, failing.passed) == (0.0, False)
    assert failing.semantic_ndcg_at_k == failing.ndcg_at_k == 0.0
    assert failing.semantic_alpha_ndcg_at_k == failing.alpha_ndcg_at_k == 0.0
    assert failing.semantic_evidence_precision_at_k == failing.evidence_precision_at_k == 0.0
    assert passing.dimensions == 3
    assert passing.mrr_at_k == passing.semantic_mrr_at_k == 1.0
    assert (passing.recall_at_k, passing.ndcg_at_k) == (1.0, 1.0)
    assert passing.alpha_ndcg_at_k == passing.semantic_alpha_ndcg_at_k == 1.0
    assert passing.evidence_precision_at_k == passing.semantic_evidence_precision_at_k == 1.0

    result_path = tmp_path / "evaluation" / "v1-result.json"
    gate = record_evaluation(result_path, result)
    recorded = json.loads(result_path.read_text())
    assert recorded["chosenDimensions"] == 3
    assert gate.dataset_version == "v1"
    assert gate.dataset_sha256 == "d" * 64
    assert gate.corpus_hash == corpus_hash(corpus_chunks)
    assert gate.chosen_dimensions == 3
    assert gate.value == 1.0
    assert len(gate.result_sha256) == 64
    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        record_evaluation(result_path, result)


def test_unresolved_relevance_target_fails_before_provider_creation() -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    calls: list[int] = []

    def provider_for(dimensions: int) -> EvaluationProvider:
        calls.append(dimensions)
        return EvaluationProvider(dimensions)

    with pytest.raises(CorpusValidationError, match="missing"):
        run_dimension_evaluation(
            dataset("missing"),
            corpus_chunks,
            provider_for,
            model="qwen/qwen3-embedding-8b",
            model_input_limit=2048,
            dimensions=(2, 3),
            corpus_hash=corpus_hash(corpus_chunks),
            dataset_sha256="d" * 64,
        )

    assert calls == []


def test_remedy_level_targets_cover_every_chunk_of_the_remedy() -> None:
    book = Book(
        book_id="alpha",
        title="Book alpha",
        author=None,
        source_path=Path("alpha.json"),
        source_sha256="a" * 64,
        remedies=(
            Remedy(
                name="REMEDY",
                sections=(
                    Section(title="Mind", passages=("mind evidence",)),
                    Section(title="Fever", passages=("fever evidence",)),
                ),
            ),
        ),
    )
    chunks = chunk_book(book)
    assert len(chunks) == 2
    dataset = EvaluationDataset(
        version="v1",
        k=1,
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                query="find alpha",
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )

    intents = _resolve_intents(dataset, chunks)
    assert intents == ((frozenset({chunk.id for chunk in chunks}),),)

    quality = _ranking_quality([[chunks[1].id]], intents, k=1, alpha=0.5)[0]
    assert quality.recall_at_k == 1.0
    assert quality.mrr_at_k == 1.0

    empty = _ranking_quality([["unrelated"]], intents, k=1, alpha=0.5)[0]
    assert empty.recall_at_k == 0.0


def test_remedy_ranking_resolves_each_target_to_one_remedy_id() -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    remedy_dataset = EvaluationDataset(
        version="v5",
        k=1,
        ranking_unit="remedy",
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                symptoms=("find alpha",),
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )

    assert _resolve_intents(remedy_dataset, corpus_chunks) == ((frozenset({"alpha\x1fREMEDY"}),),)


def test_remedy_ranking_rejects_passage_level_targets() -> None:
    with pytest.raises(ValidationError, match="remedy-level"):
        EvaluationDataset(
            version="v5",
            k=1,
            ranking_unit="remedy",
            quality_metric="recallAtK",
            minimum_quality=0.8,
            queries=(
                EvaluationQuery(
                    id="q1",
                    symptoms=("find alpha",),
                    relevant=(
                        EvaluationTarget(
                            book_id="alpha",
                            remedy_name="REMEDY",
                            section_title="Mind",
                        ),
                    ),
                ),
            ),
        )


def test_global_remedy_ranking_matches_the_same_remedy_from_any_book() -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    global_dataset = EvaluationDataset(
        version="v6",
        k=1,
        ranking_unit="globalRemedy",
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                symptoms=("find remedy",),
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )

    intents = _resolve_intents(global_dataset, corpus_chunks)
    beta_chunk = next(chunk for chunk in corpus_chunks if chunk.book_id == "beta")
    rankings = _rankings_for_unit(
        ((beta_chunk.id,),),
        "globalRemedy",
        {chunk.id: chunk.remedy_name for chunk in corpus_chunks},
    )

    assert intents == ((frozenset({"REMEDY"}),),)
    assert rankings == (("REMEDY",),)
    assert _ranking_quality(rankings, intents, k=1, alpha=0.5)[0].recall_at_k == 1.0


def test_global_remedy_ranking_rejects_duplicate_target_names() -> None:
    with pytest.raises(ValidationError, match="unique remedy names"):
        EvaluationDataset(
            version="v6",
            k=1,
            ranking_unit="globalRemedy",
            quality_metric="recallAtK",
            minimum_quality=0.8,
            queries=(
                EvaluationQuery(
                    id="q1",
                    symptoms=("find remedy",),
                    relevant=(
                        EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),
                        EvaluationTarget(book_id="beta", remedy_name="REMEDY"),
                    ),
                ),
            ),
        )


def test_normalized_score_fusion_requires_global_remedy_ranking() -> None:
    with pytest.raises(ValidationError, match="requires global remedy"):
        EvaluationDataset(
            version="v7",
            k=1,
            fusion_strategy="normalizedScore",
            quality_metric="recallAtK",
            minimum_quality=0.8,
            queries=(
                EvaluationQuery(
                    id="q1",
                    symptoms=("raw symptom",),
                    relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
                ),
            ),
        )


def test_normalized_identity_rejects_duplicate_intents_with_different_typography() -> None:
    with pytest.raises(ValidationError, match="unique remedy names"):
        EvaluationDataset(
            version="v8",
            k=8,
            ranking_unit="globalRemedy",
            remedy_name_normalization="nfkcCasefoldWhitespace",
            quality_metric="recallAtK",
            minimum_quality=0.8,
            queries=(
                EvaluationQuery(
                    id="q1",
                    symptoms=("pain",),
                    relevant=(
                        EvaluationTarget(book_id="alpha", remedy_name="SULPHUR"),
                        EvaluationTarget(book_id="beta", remedy_name=" Sulphur "),
                    ),
                ),
            ),
        )


def test_normalized_identity_requires_global_remedy_ranking() -> None:
    with pytest.raises(ValidationError, match="requires global remedy"):
        EvaluationDataset.model_validate({
            **dataset().model_dump(),
            "remedy_name_normalization": "nfkcCasefoldWhitespace",
        })


def test_content_queries_and_cross_book_identity_recover_a_matching_remedy(monkeypatch) -> None:
    corpus_chunks = tuple(
        replace(chunk, remedy_name="Remedy" if chunk.book_id == "beta" else "REMEDY")
        for book in books()
        for chunk in chunk_book(book)
    )
    beta_id = next(chunk.id for chunk in corpus_chunks if chunk.book_id == "beta")
    lexical_inputs = []
    semantic_inputs = []
    provider = EvaluationProvider(3)

    def embed_query(text):
        semantic_inputs.append(text)
        return (1.0, 0.0, 1.0)

    provider.embed_query = embed_query

    def lexical(_chunks, queries, **_kwargs):
        lexical_inputs.extend(queries)
        return ((),)

    monkeypatch.setattr("homeoremedica_corpus.evaluation.score_lexical_queries", lexical)
    monkeypatch.setattr(
        "homeoremedica_corpus.evaluation.score_semantic_queries",
        lambda *_args, **_kwargs: ((ScoredCandidate(beta_id, 0.9),),),
    )
    query_dataset = EvaluationDataset(
        version="v8",
        k=1,
        ranking_unit="globalRemedy",
        fusion_strategy="normalizedScore",
        remedy_name_normalization="nfkcCasefoldWhitespace",
        lexical_query_mode="contentTerms",
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                symptoms=("He was not worse after walking.",),
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )
    result = run_dimension_evaluation(
        query_dataset,
        corpus_chunks,
        lambda _dimensions: provider,
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(3,),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="d" * 64,
    )
    assert semantic_inputs == ["He was not worse after walking."]
    assert lexical_inputs == ["not worse after walking"]
    assert result.remedy_name_normalization == "nfkcCasefoldWhitespace"
    assert result.lexical_query_mode == "contentTerms"
    assert result.scores[0].recall_at_k == 1.0

    # Source labels are still validated literally against the specified book.
    invalid_query = query_dataset.queries[0].model_copy(
        update={
            "relevant": (EvaluationTarget(book_id="alpha", remedy_name="Remedy"),),
        }
    )
    with pytest.raises(CorpusValidationError, match="unresolved target"):
        _resolve_intents(
            query_dataset.model_copy(update={"queries": (invalid_query,)}), corpus_chunks
        )


def test_rejects_passage_index_without_section_title() -> None:
    with pytest.raises(ValidationError):
        EvaluationTarget(book_id="alpha", remedy_name="REMEDY", passage_index=0)


def test_each_query_symptom_is_a_raw_semantic_and_lexical_input() -> None:
    query = EvaluationQuery(
        id="q1",
        symptoms=("Head pain.", "Worse from heat."),
        relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
    )

    assert query.semantic_inputs == ("Head pain.", "Worse from heat.")
    assert query.lexical_inputs == ("Head pain.", "Worse from heat.")


def test_semantic_instruction_preserves_raw_queries_and_lexical_inputs() -> None:
    original = dataset()
    instructed = original.model_copy(update={"semantic_query_instruction": "Retrieve passages."})
    assert original.semantic_input_groups == (("find alpha",),)
    assert instructed.semantic_input_groups == (
        ("Instruct: Retrieve passages.\nQuery:find alpha",),
    )
    assert instructed.queries == original.queries
    assert instructed.queries[0].lexical_inputs == ("find alpha",)
    with pytest.raises(ValidationError, match="instruction must be non-empty"):
        EvaluationDataset.model_validate({
            **original.model_dump(),
            "semantic_query_instruction": "  \n ",
        })


def test_dimension_evaluation_embeds_each_raw_query_symptom() -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    provider = EvaluationProvider(3)
    query_dataset = EvaluationDataset(
        version="v4",
        k=1,
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                symptoms=("Head pain.", "Worse from heat."),
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )
    query_inputs: list[str] = []
    original_embed = provider.embed_query

    def record_query(text: str) -> tuple[float, ...]:
        query_inputs.append(text)
        return original_embed(text)

    provider.embed_query = record_query  # type: ignore[method-assign]

    run_dimension_evaluation(
        query_dataset,
        corpus_chunks,
        lambda _dimensions: provider,
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(2, 3),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="d" * 64,
    )

    assert query_inputs == ["Head pain.", "Worse from heat."]


def test_dimension_evaluation_reuses_cached_embeddings(tmp_path: Path) -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    providers: list[EvaluationProvider] = []

    def provider_for(dimensions: int) -> EvaluationProvider:
        provider = EvaluationProvider(dimensions)
        providers.append(provider)
        return provider

    for _ in range(2):
        run_dimension_evaluation(
            dataset(),
            corpus_chunks,
            provider_for,
            model="qwen/qwen3-embedding-8b",
            model_input_limit=2048,
            dimensions=(3,),
            corpus_hash=corpus_hash(corpus_chunks),
            dataset_sha256="d" * 64,
            embedding_cache_directory=tmp_path / "cache",
        )

    assert providers[0].events == ["count", "count", "document", "document", "query"]
    assert providers[1].events == ["count", "count"]
    assert sorted(path.name.split("-", 1)[0] for path in (tmp_path / "cache").iterdir()) == [
        "documents",
        "queries",
    ]


@pytest.mark.parametrize("semantic_weight", [1.0, 2.0])
def test_dimension_evaluation_uses_normalized_global_remedy_score_fusion(
    tmp_path: Path,
    semantic_weight: float,
) -> None:
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    score_dataset = EvaluationDataset(
        version="v7",
        k=1,
        ranking_unit="globalRemedy",
        fusion_strategy="normalizedScore",
        semantic_score_weight=semantic_weight,
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                symptoms=("the raw user symptom",),
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )

    result = run_dimension_evaluation(
        score_dataset,
        corpus_chunks,
        lambda dimensions: EvaluationProvider(dimensions),
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(3,),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="d" * 64,
        embedding_cache_directory=tmp_path / "cache",
    )

    assert result.chosen_dimensions == 3
    assert result.retrieval_strategy == "symptomGlobalRemedyNormalizedScoreFusion"
    assert result.reciprocal_rank_constant is None
    assert result.score_fusion_normalization == "perRankingMinMax"
    assert result.score_fusion_exponent == 2.0
    assert result.semantic_score_weight == semantic_weight
    assert result.scores[0].recall_at_k == 1.0
    assert sorted(path.suffix for path in (tmp_path / "cache").iterdir()) == [
        ".bin",
        ".bin",
        ".f32",
        ".f32",
    ]

    def reject_provider(_dimensions: int) -> EvaluationProvider:
        raise AssertionError("ranking cache should bypass the embedding provider")

    cached_result = run_dimension_evaluation(
        score_dataset,
        corpus_chunks,
        reject_provider,
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(3,),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="d" * 64,
        embedding_cache_directory=tmp_path / "cache",
    )
    assert cached_result == result

    # Changing lexical preprocessing must reuse semantic candidates while caching
    # a distinct lexical search. The source query remains unchanged for embeddings.
    filtered_dataset = score_dataset.model_copy(
        update={
            "lexical_query_mode": "contentTerms",
            "remedy_name_normalization": "nfkcCasefoldWhitespace",
        }
    )
    filtered_result = run_dimension_evaluation(
        filtered_dataset,
        corpus_chunks,
        reject_provider,
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(3,),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="e" * 64,
        embedding_cache_directory=tmp_path / "cache",
    )
    assert filtered_result.scores[0].recall_at_k == 1.0
    assert len(tuple((tmp_path / "cache").glob("semantic-rankings-*.bin"))) == 1
    assert len(tuple((tmp_path / "cache").glob("lexical-rankings-*.bin"))) == 2

    instructed_provider = EvaluationProvider(3)
    query_inputs = []
    original_embed_query = instructed_provider.embed_query

    def embed_instructed_query(text):
        query_inputs.append(text)
        return original_embed_query(text)

    instructed_provider.embed_query = embed_instructed_query
    instructed_result = run_dimension_evaluation(
        filtered_dataset.model_copy(update={"semantic_query_instruction": "Retrieve passages."}),
        corpus_chunks,
        lambda _dimensions: instructed_provider,
        model="qwen/qwen3-embedding-8b",
        model_input_limit=2048,
        dimensions=(3,),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="f" * 64,
        embedding_cache_directory=tmp_path / "cache",
    )
    assert query_inputs == ["Instruct: Retrieve passages.\nQuery:the raw user symptom"]
    assert instructed_provider.events == ["count", "count", "query"]
    assert instructed_result.semantic_query_instruction == "Retrieve passages."
    assert len(tuple((tmp_path / "cache").glob("documents-*.f32"))) == 1
    assert len(tuple((tmp_path / "cache").glob("queries-*.f32"))) == 2
    assert len(tuple((tmp_path / "cache").glob("semantic-rankings-*.bin"))) == 2
    assert len(tuple((tmp_path / "cache").glob("lexical-rankings-*.bin"))) == 2


def test_symptom_rankings_are_fused_back_into_one_case_ranking() -> None:
    rankings = (
        ("shared", "first"),
        ("second", "shared"),
        ("third",),
    )

    aggregated = _aggregate_query_rankings(rankings, (2, 1), limit=2, rank_constant=60)

    assert aggregated == (("shared", "second"), ("third",))


def test_remedy_rankings_combine_distinct_chunks_of_the_same_remedy() -> None:
    chunk_remedies = {
        "remedy-a-mind": "book\x1fREMEDY A",
        "remedy-a-head": "book\x1fREMEDY A",
        "remedy-b": "book\x1fREMEDY B",
    }
    rankings = (
        ("remedy-a-mind", "remedy-b"),
        ("remedy-a-head", "remedy-b"),
    )

    remedy_rankings = _rankings_for_unit(rankings, "remedy", chunk_remedies)
    aggregated = _aggregate_query_rankings(remedy_rankings, (2,), limit=2, rank_constant=60)

    assert remedy_rankings == (
        ("book\x1fREMEDY A", "book\x1fREMEDY B"),
        ("book\x1fREMEDY A", "book\x1fREMEDY B"),
    )
    assert aggregated == (("book\x1fREMEDY A", "book\x1fREMEDY B"),)


def test_normalized_score_fusion_suppresses_weak_tail_matches() -> None:
    rankings = (
        (ScoredCandidate("specific-a", 1.0), ScoredCandidate("broad", 0.2)),
        (ScoredCandidate("specific-b", 0.8), ScoredCandidate("broad", 0.2)),
    )

    aggregated = _aggregate_scored_query_rankings(rankings, (2,), limit=3, exponent=2.0)

    assert aggregated == (("specific-a", "specific-b", "broad"),)


def test_scored_global_remedy_ranking_keeps_the_strongest_cross_book_chunk() -> None:
    rankings = (
        (
            ScoredCandidate("alpha-remedy", 0.9),
            ScoredCandidate("beta-remedy", 0.8),
            ScoredCandidate("other", 0.7),
        ),
    )
    mapping = {
        "alpha-remedy": "REMEDY",
        "beta-remedy": "REMEDY",
        "other": "OTHER",
    }

    collapsed = _scored_rankings_for_unit(rankings, mapping)

    assert collapsed == ((ScoredCandidate("REMEDY", 1.0), ScoredCandidate("OTHER", 0.0)),)


def test_scored_ranking_cache_round_trips_and_rejects_trailing_data(tmp_path: Path) -> None:
    path = tmp_path / "rankings.bin"
    chunk_ids = ("chunk-a", "chunk-b")
    rankings = (
        (ScoredCandidate("chunk-b", 0.75), ScoredCandidate("chunk-a", 0.25)),
        (),
    )

    _store_scored_ranking_cache(path, chunk_ids, rankings)

    assert _load_scored_ranking_cache(path, chunk_ids, 2) == rankings
    path.write_bytes(path.read_bytes() + b"invalid")
    with pytest.raises(RuntimeError, match="trailing data"):
        _load_scored_ranking_cache(path, chunk_ids, 2)


def test_ranking_quality_discounts_repeated_intent_coverage() -> None:
    # Query with two intents: chunk c1 satisfies both, chunk c2 only the second.
    # Ranking c2 first repeats intent 2 before covering intent 1, which the
    # greedy ideal ordering (c1, c2) avoids, so alpha-nDCG penalizes it.
    intents = (frozenset({"c1"}), frozenset({"c1", "c2"}))
    quality = _ranking_quality([("c2", "c1")], [intents], k=2, alpha=0.5)[0]

    assert quality.recall_at_k == 1.0
    assert quality.mrr_at_k == 1.0
    assert quality.ndcg_at_k == 1.0
    assert quality.alpha_ndcg_at_k == pytest.approx(
        (1.0 + 1.5 / math.log2(3)) / (2.0 + 0.5 / math.log2(3))
    )
    assert quality.evidence_precision_at_k == pytest.approx((0.5 + 0.75) / 2)


def test_ranking_quality_reduces_to_precision_for_single_intent_queries() -> None:
    intents = (frozenset({"c1"}),)
    quality = _ranking_quality(
        [("c9", "c1", "c8", "c7", "c6", "c5", "c4", "c3")], [intents], k=8, alpha=0.5
    )[0]

    assert quality.recall_at_k == 1.0
    assert quality.mrr_at_k == 0.5
    assert quality.ndcg_at_k == pytest.approx(1 / math.log2(3))
    assert quality.alpha_ndcg_at_k == pytest.approx(quality.ndcg_at_k)
    assert quality.evidence_precision_at_k == pytest.approx(1 / 8)


@pytest.mark.parametrize("weight,expected_recall", [(1.0, 0.0), (2.0, 1.0)])
def test_semantic_weight_changes_fused_ranking_only(monkeypatch, weight, expected_recall):
    corpus_chunks = tuple(chunk for book in books() for chunk in chunk_book(book))
    score_dataset = EvaluationDataset(
        version="weighted",
        k=1,
        ranking_unit="globalRemedy",
        fusion_strategy="normalizedScore",
        semantic_score_weight=weight,
        quality_metric="recallAtK",
        minimum_quality=0.8,
        queries=(
            EvaluationQuery(
                id="q1",
                query="evidence",
                relevant=(EvaluationTarget(book_id="alpha", remedy_name="REMEDY"),),
            ),
        ),
    )
    # Controlled normalized candidates isolate channel weighting from retrieval.
    channels = iter((
        ((ScoredCandidate("OTHER", 1.0), ScoredCandidate("REMEDY", 0.5)),),
        ((ScoredCandidate("REMEDY", 1.0), ScoredCandidate("OTHER", 0.7)),),
    ))
    monkeypatch.setattr(
        "homeoremedica_corpus.evaluation._scored_rankings_for_unit",
        lambda *_: next(channels),
    )
    result = run_dimension_evaluation(
        score_dataset,
        corpus_chunks,
        lambda dimensions: EvaluationProvider(dimensions),
        model="test",
        model_input_limit=2048,
        dimensions=(3,),
        corpus_hash=corpus_hash(corpus_chunks),
        dataset_sha256="d" * 64,
    )
    assert result.scores[0].recall_at_k == expected_recall
    assert result.scores[0].semantic_recall_at_k == 1.0
    assert result.lexical_recall_at_k == 0.0


@pytest.mark.parametrize("weight", [0, -1, float("inf"), float("nan")])
def test_semantic_weight_rejects_invalid_values(weight):
    with pytest.raises(ValueError):
        EvaluationDataset.model_validate({
            **dataset().model_dump(),
            "semantic_score_weight": weight,
        })
