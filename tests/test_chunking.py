from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from homeoremedica_corpus.chunking import ChunkingPolicy, chunk_book
from homeoremedica_corpus.sources import Book, Remedy, Section


def passage(words: int, marker: str) -> str:
    return " ".join([marker] * words)


def sample_book(passages: tuple[str, ...]) -> Book:
    return Book(
        book_id="sample-book",
        title="Sample Book",
        author="An Author",
        source_path=Path("sample-book.json"),
        source_sha256="0" * 64,
        remedies=(
            Remedy(
                name="Äbies / NIGRA",
                sections=(Section(title="Mind & Head", passages=passages),),
            ),
        ),
    )


def count_words(text: str) -> int:
    return len(text.split())


def test_keeps_a_short_section_in_one_contextualized_chunk() -> None:
    chunks = chunk_book(
        sample_book(("Irritable.", "Feels light-headed.")),
        ChunkingPolicy(target_tokens=500, minimum_tokens=300),
        count_words,
    )

    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk.book_id == "sample-book"
    assert chunk.remedy_name == "Äbies / NIGRA"
    assert chunk.remedy_slug == "abies-nigra"
    assert chunk.section_title == "Mind & Head"
    assert chunk.section_slug == "mind-head"
    assert chunk.passage_indexes == (0, 1)
    assert chunk.part == 1
    assert chunk.text == "Irritable.\n\nFeels light-headed."
    assert chunk.embedding_text == (
        "Book: Sample Book\n"
        "Remedy: Äbies / NIGRA\n"
        "Section: Mind & Head\n"
        "Text: Irritable.\n\nFeels light-headed."
    )


def test_splits_only_at_passage_boundaries_without_overlap_or_loss() -> None:
    passages = tuple(passage(200, marker) for marker in ("zero", "one", "two"))
    chunks = chunk_book(
        sample_book(passages),
        ChunkingPolicy(target_tokens=500, minimum_tokens=300),
        count_words,
    )

    assert [chunk.passage_indexes for chunk in chunks] == [(0, 1), (2,)]
    assert [chunk.part for chunk in chunks] == [1, 2]
    indexes = [index for chunk in chunks for index in chunk.passage_indexes]
    assert indexes == list(range(len(passages)))
    assert [text for chunk in chunks for text in chunk.passages] == list(passages)
    assert all("\n\n".join(chunk.passages) == chunk.text for chunk in chunks)


def test_rebalances_a_small_tail_when_boundaries_allow_two_target_sized_chunks() -> None:
    passages = tuple(passage(100, str(index)) for index in range(6))

    chunks = chunk_book(
        sample_book(passages),
        ChunkingPolicy(target_tokens=500, minimum_tokens=300),
        count_words,
    )

    assert [chunk.passage_indexes for chunk in chunks] == [(0, 1, 2), (3, 4, 5)]
    assert [count_words(chunk.text) for chunk in chunks] == [300, 300]


def test_keeps_an_indivisible_long_passage_intact() -> None:
    long_passage = passage(600, "long")
    chunks = chunk_book(
        sample_book((long_passage, passage(100, "tail"))),
        ChunkingPolicy(target_tokens=500, minimum_tokens=300),
        count_words,
    )

    assert chunks[0].passages == (long_passage,)
    assert chunks[0].text == long_passage


def test_chunk_ids_are_deterministic_and_content_addressed() -> None:
    book = sample_book((passage(400, "same"), passage(400, "next")))
    policy = ChunkingPolicy(target_tokens=500, minimum_tokens=300)

    first = chunk_book(book, policy, count_words)
    second = chunk_book(book, policy, count_words)
    changed_book = replace(
        book,
        remedies=(
            replace(
                book.remedies[0],
                sections=(replace(book.remedies[0].sections[0], passages=("changed",)),),
            ),
        ),
    )
    changed = chunk_book(changed_book, policy, count_words)

    assert [chunk.id for chunk in first] == [chunk.id for chunk in second]
    assert len(set(chunk.id for chunk in first)) == len(first)
    assert changed[0].id != first[0].id
