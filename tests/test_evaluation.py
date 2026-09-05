from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from homeoremedica_corpus.chunking import chunk_book, corpus_hash
from homeoremedica_corpus.evaluation import (
    EvaluationDataset,
    EvaluationQuery,
    EvaluationTarget,
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
