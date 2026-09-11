from __future__ import annotations

from pathlib import Path

from homeoremedica_corpus.chunking import ChunkingPolicy, chunk_book
from homeoremedica_corpus.sources import Book, Remedy, Section
from homeoremedica_evaluation.retrieval import (
    lexical_content_terms,
    normalized_remedy_name,
    rank_lexical_queries,
    rank_semantic_queries,
    reciprocal_rank_fusion,
    score_lexical_queries,
    score_semantic_queries,
)


def test_remedy_identity_unifies_typography_but_not_different_remedies() -> None:
    fullwidth_name = "  Ｓｕｌｐｈｕｒ\u00a0 "  # noqa: RUF001 -- deliberate typography fixture
    assert normalized_remedy_name(fullwidth_name) == normalized_remedy_name("SULPHUR")
    assert normalized_remedy_name("Natrum   Muriaticum") == "natrum muriaticum"
    assert normalized_remedy_name("Natrum muriaticum") != normalized_remedy_name(
        "Natrum carbonicum"
    )
    assert normalized_remedy_name("Sulphur") != normalized_remedy_name("Sulphur iodatum")


def test_lexical_content_terms_keep_explicit_negation_and_modalities() -> None:
    assert (
        lexical_content_terms(
            "He was not worse before walking, but better after walking down during rain."
        )
        == "not worse before walking better after walking down during rain"
    )
    assert lexical_content_terms("no pain without cold") == "no pain without cold"
    assert lexical_content_terms("He was there and it was his.") == ""


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

    scored = score_lexical_queries(corpus_chunks, ("monster",), limit=2)
    assert tuple(candidate.chunk_id for candidate in scored[0]) == (corpus_chunks[0].id,)
    assert scored[0][0].score > 0


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

    scored = score_semantic_queries(
        tuple(chunk.id for chunk in corpus_chunks),
        ((0.0, 1.0, 1.0), (1.0, 0.0, -1.0)),
        ((1.0, 0.0, 1.0),),
        dimensions=3,
        limit=2,
    )
    assert tuple(candidate.chunk_id for candidate in scored[0]) == rankings[0]
    assert scored[0][0].score > scored[0][1].score


def test_reciprocal_rank_fusion_rewards_results_found_by_both_channels() -> None:
    assert reciprocal_rank_fusion(
        (("semantic", "shared"), ("shared", "lexical")), rank_constant=60
    ) == ("shared", "semantic", "lexical")
