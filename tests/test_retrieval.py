from __future__ import annotations

from pathlib import Path

from homeoremedica_corpus.chunking import ChunkingPolicy, chunk_book
from homeoremedica_corpus.retrieval import (
    rank_lexical_queries,
    rank_semantic_queries,
    reciprocal_rank_fusion,
)
from homeoremedica_corpus.sources import Book, Remedy, Section


def chunks():
    book = Book(
        book_id="book",
        title="Book",
        author=None,
        source_path=Path("book.json"),
        source_sha256="a" * 64,
        remedies=(
            Remedy(
                name="FIRST",
                sections=(Section(title="Mind", passages=("Dreaming of monsters.",)),),
            ),
            Remedy(
                name="SECOND",
                sections=(Section(title="Sleep", passages=("Restless at night.",)),),
            ),
        ),
    )
    return chunk_book(book, ChunkingPolicy(target_tokens=1, minimum_tokens=1))


def test_lexical_ranking_uses_safe_or_terms_and_porter_stemming() -> None:
    corpus_chunks = chunks()

    rankings = rank_lexical_queries(
        corpus_chunks,
        ("Which remedy dreams about a monster?", "___"),
        limit=2,
    )

    assert rankings == ((corpus_chunks[0].id,), ())


def test_semantic_ranking_derives_and_normalizes_dimension_prefixes() -> None:
    corpus_chunks = chunks()

    rankings = rank_semantic_queries(
        tuple(chunk.id for chunk in corpus_chunks),
        ((0.0, 1.0, 1.0), (1.0, 0.0, -1.0)),
        ((1.0, 0.0, 1.0),),
        dimensions=3,
        limit=2,
    )

    assert rankings == ((corpus_chunks[0].id, corpus_chunks[1].id),)


def test_reciprocal_rank_fusion_rewards_results_found_by_both_channels() -> None:
    assert reciprocal_rank_fusion(
        (("semantic", "shared"), ("shared", "lexical")), rank_constant=60
    ) == ("shared", "semantic", "lexical")
