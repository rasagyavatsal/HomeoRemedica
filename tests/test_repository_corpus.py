from __future__ import annotations

from pathlib import Path

import pytest

from homeoremedica_corpus.chunking import chunk_book, corpus_hash
from homeoremedica_corpus.config import load_pipeline_config
from homeoremedica_corpus.evaluation import load_evaluation_dataset, load_evaluation_gate
from homeoremedica_corpus.sources import load_books

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(
    not (ROOT / "dataset" / "processed").is_dir(),
    reason="private repository corpus is not present",
)


def test_repository_processed_corpus_matches_config_and_conserves_every_passage() -> None:
    config = load_pipeline_config(ROOT / "corpus.toml")
    books = load_books(config.processed_directory, config.books)

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


def test_repository_evaluation_passes_and_pins_the_smallest_approved_dimension() -> None:
    config = load_pipeline_config(ROOT / "corpus.toml")
    if not config.evaluation_result.exists():
        pytest.skip(
            "pending evaluation for the configured dataset; run "
            "`homeoremedica-corpus evaluate` once the OpenRouter key is configured"
        )
    books = load_books(config.processed_directory, config.books)
    chunks = tuple(chunk for book in books for chunk in chunk_book(book, config.chunking))
    _, dataset_digest = load_evaluation_dataset(config.evaluation_dataset)
    gate = load_evaluation_gate(config.evaluation_result)

    assert gate.dataset_sha256 == dataset_digest
    assert gate.corpus_hash == corpus_hash(chunks)
    assert gate.value >= gate.threshold
    assert gate.chosen_dimensions == config.embedding.dimensions == 1536
