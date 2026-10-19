from __future__ import annotations

from pathlib import Path

import pytest

from corpus.chunking import chunk_book
from corpus.config import load_pipeline_config
from corpus.sources import load_corpus_books

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(
    not (ROOT / "dataset" / "corpus.json").is_file(),
    reason="repository corpus is not present",
)


def repository_books(config):
    return load_corpus_books(config.corpus_dataset, config.books)


def test_repository_corpus_matches_config_and_conserves_every_passage() -> None:
    config = load_pipeline_config(ROOT / "corpus.toml")
    books = repository_books(config)

    assert {book.book_id for book in books} == set(config.books)
    assert sum(
        len(section.passages)
        for book in books
        for remedy in book.remedies
        for section in remedy.sections
    ) == 118_259
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

