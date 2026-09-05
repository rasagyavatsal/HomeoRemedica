from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import pytest
from pydantic import ValidationError

from homeoremedica_corpus.chunking import chunk_book, corpus_hash
from homeoremedica_corpus.evaluation import (
    EvaluationDataset,
    EvaluationQuery,
    EvaluationTarget,
    _ranking_quality,
    _resolve_intents,
    record_evaluation,
    run_dimension_evaluation,
)
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
    assert result.evaluation_schema_version == 3
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
    assert (
        failing.semantic_evidence_precision_at_k == failing.evidence_precision_at_k == 0.0
    )
    assert passing.dimensions == 3
    assert passing.mrr_at_k == passing.semantic_mrr_at_k == 1.0
    assert (passing.recall_at_k, passing.ndcg_at_k) == (1.0, 1.0)
    assert passing.alpha_ndcg_at_k == passing.semantic_alpha_ndcg_at_k == 1.0
    assert (
        passing.evidence_precision_at_k == passing.semantic_evidence_precision_at_k == 1.0
    )

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


def test_rejects_passage_index_without_section_title() -> None:
    with pytest.raises(ValidationError):
        EvaluationTarget(book_id="alpha", remedy_name="REMEDY", passage_index=0)


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
