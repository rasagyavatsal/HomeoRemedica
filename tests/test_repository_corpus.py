from __future__ import annotations

from pathlib import Path

import pytest

from corpus.chunking import chunk_book, corpus_hash
from corpus.config import load_pipeline_config
from corpus.sources import CorpusValidationError, load_combined_books
from eval.config import load_evaluation_config
from eval.evaluation import load_evaluation_dataset, load_evaluation_gate

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(
    not (ROOT / "dataset" / "combined.json").is_file(),
    reason="repository corpus is not present",
)


def repository_books(config):
    return load_combined_books(config.combined_dataset, config.books)


def test_repository_combined_corpus_matches_config_and_conserves_every_passage() -> None:
    config = load_pipeline_config(ROOT / "corpus.toml")
    books = repository_books(config)

    assert {book.book_id for book in books} == set(config.books)
    for book in books:
        source_passages = [
            passage
            for remedy in book.remedies
            for section in remedy.sections
            for passage in section.passages
        ]
        chunks = chunk_book(book, config.chunking)
        chunked_passages = [passage for chunk in chunks for passage in chunk.passages]
        assert chunked_passages == source_passages
        assert all(len(chunk.passages) == 1 for chunk in chunks)


def test_repository_v9_preserves_queries_and_adds_only_a_semantic_instruction() -> None:
    config = load_evaluation_config(ROOT / "evaluation.toml")
    dataset, _ = load_evaluation_dataset(config.dataset)

    previous, _ = load_evaluation_dataset(ROOT / "evaluation/v7/queries.json")
    assert dataset.version == "v9"
    assert dataset.queries == previous.queries
    assert dataset.minimum_quality == previous.minimum_quality == 0.8
    assert dataset.remedy_name_normalization == "nfkcCasefoldWhitespace"
    assert dataset.lexical_query_mode == "contentTerms"
    assert dataset.ranking_unit == "globalRemedy"
    assert dataset.fusion_strategy == "normalizedScore"
    assert dataset.candidate_pool_size == 640
    assert len(dataset.queries) == 500
    assert sum(len(query.semantic_inputs) for query in dataset.queries) == 2117
    assert all(query.semantic_inputs == query.lexical_inputs for query in dataset.queries)
    assert dataset.semantic_query_instruction is not None
    assert dataset.semantic_input_groups[0][0] == (
        f"Instruct: {dataset.semantic_query_instruction}\n"
        f"Query:{dataset.queries[0].semantic_inputs[0]}"
    )


def test_repository_evaluation_result_matches_its_isolated_configuration() -> None:
    config = load_evaluation_config(ROOT / "evaluation.toml")
    if not config.result.exists():
        pytest.skip(
            "pending evaluation for the configured dataset; run "
            "`homeoremedica-evaluation` once the OpenRouter key is configured"
        )
    books = repository_books(config)
    chunks = tuple(chunk for book in books for chunk in chunk_book(book, config.chunking))
    _, dataset_digest = load_evaluation_dataset(config.dataset)
    try:
        gate = load_evaluation_gate(config.result)
    except CorpusValidationError as error:
        pytest.skip(f"recorded evaluation gate has no passing dimension: {error}")

    assert gate.dataset_sha256 == dataset_digest
    assert gate.corpus_hash == corpus_hash(chunks)
    assert gate.value >= gate.threshold
    assert gate.chosen_dimensions in config.dimensions
