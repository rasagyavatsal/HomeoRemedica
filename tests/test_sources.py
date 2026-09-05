from __future__ import annotations

import json
from pathlib import Path

import pytest

from homeoremedica_corpus.sources import (
    BookDefinition,
    CorpusValidationError,
    load_combined_books,
)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def definitions(**titles: str) -> dict[str, BookDefinition]:
    return {book_id: BookDefinition(title=title) for book_id, title in titles.items()}


def definitions_with_authors(**books: tuple[str, str | None]) -> dict[str, BookDefinition]:
    return {
        book_id: BookDefinition(title=title, author=author)
        for book_id, (title, author) in books.items()
    }


def combined_value(books: dict[str, object], remedies: dict[str, object]) -> dict[str, object]:
    return {
        "metadata": {
            "schema_version": 1,
            "generated_at": "2026-09-05T06:39:00Z",
            "books": books,
        },
        "remedies": remedies,
    }


def test_loads_one_book_per_configured_id_from_the_combined_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "dataset" / "combined.json"
    write_json(
        path,
        combined_value(
            books={"sample": {"title": "Sample Book"}},
            remedies={
                "Original Name": {"sample": {"Mind": ["  Preserve me.  "]}},
            },
        ),
    )
    write_json(tmp_path / "dataset" / "raw-text" / "trap.json", {"trap": []})
    write_json(tmp_path / "output" / "trap.json", {"trap": []})

    reads: list[Path] = []
    original_read_bytes = Path.read_bytes

    def record_read(path: Path) -> bytes:
        reads.append(path)
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", record_read)

    books = load_combined_books(path, definitions(sample="Sample Book"))

    assert reads == [path]
    assert [book.book_id for book in books] == ["sample"]
    assert books[0].title == "Sample Book"
    assert books[0].source_path == path
    assert len(books[0].source_sha256) == 64
    assert books[0].remedies[0].name == "Original Name"
    assert books[0].remedies[0].sections[0].title == "Mind"
    assert books[0].remedies[0].sections[0].passages == ("  Preserve me.  ",)


def test_splits_remedy_merged_sections_into_per_book_remedies(tmp_path: Path) -> None:
    path = tmp_path / "dataset" / "combined.json"
    write_json(
        path,
        combined_value(
            books={
                "beta": {"title": "Beta Book", "author": "B. Author"},
                "alpha": {"title": "Alpha Book"},
            },
            remedies={
                "Aconite": {
                    "beta": {"Mind": ["beta mind"], "Fever": ["beta fever"]},
                    "alpha": {"Mind": ["alpha mind"]},
                },
                "Belladonna": {"beta": {"Eye": ["beta eye"]}},
            },
        ),
    )

    books = load_combined_books(
        path,
        definitions_with_authors(
            alpha=("Alpha Book", None),
            beta=("Beta Book", "B. Author"),
        ),
    )

    assert [book.book_id for book in books] == ["alpha", "beta"]
    alpha, beta = books
    assert [remedy.name for remedy in alpha.remedies] == ["Aconite"]
    assert alpha.remedies[0].sections[0].passages == ("alpha mind",)
    assert [remedy.name for remedy in beta.remedies] == ["Aconite", "Belladonna"]
    assert [(section.title, section.passages) for section in beta.remedies[0].sections] == [
        ("Mind", ("beta mind",)),
        ("Fever", ("beta fever",)),
    ]
    assert beta.author == "B. Author"
    assert alpha.author is None


def test_rejects_missing_file_and_symbolic_link(tmp_path: Path) -> None:
    path = tmp_path / "dataset" / "combined.json"
    with pytest.raises(CorpusValidationError, match="does not exist"):
        load_combined_books(path, definitions(sample="Sample Book"))

    outside = tmp_path / "outside.json"
    write_json(outside, combined_value(books={}, remedies={}))
    path.parent.mkdir(parents=True)
    path.symlink_to(outside)
    with pytest.raises(CorpusValidationError, match="symbolic link"):
        load_combined_books(path, definitions(sample="Sample Book"))


@pytest.mark.parametrize(
    ("value", "location", "message"),
    [
        ([], "$", "top level must contain exactly"),
        ({}, "$", "top level must contain exactly"),
        (
            {"metadata": {"schema_version": 1, "generated_at": "x", "books": {}}, "other": {}},
            "$",
            "top level must contain exactly",
        ),
        (
            {"metadata": {}, "remedies": {}},
            "$.metadata",
            "must contain exactly 'schema_version', 'generated_at', and 'books'",
        ),
        (
            {
                "metadata": {"schema_version": 2, "generated_at": "x", "books": {}},
                "remedies": {},
            },
            "$.metadata.schema_version",
            "must be 1",
        ),
        (
            {
                "metadata": {"schema_version": 1, "generated_at": "", "books": {}},
                "remedies": {},
            },
            "$.metadata.generated_at",
            "non-empty string",
        ),
        (
            {
                "metadata": {"schema_version": 1, "generated_at": "x", "books": {}},
                "remedies": {},
            },
            "$.metadata.books",
            "must match the configured book IDs exactly",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Other Title"}},
                },
                "remedies": {},
            },
            "$.metadata.books.sample.title",
            "must match the configured display title",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book", "author": "Other Author"}},
                },
                "remedies": {},
            },
            "$.metadata.books.sample.author",
            "must match the configured author",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book"}},
                },
                "remedies": {},
            },
            "$.remedies",
            "must contain at least one remedy",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book"}},
                },
                "remedies": {"A": {}},
            },
            "$.remedies.A",
            "at least one book",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book"}},
                },
                "remedies": {"A": {"unknown": {"Mind": ["text"]}}},
            },
            "$.remedies.A.unknown",
            "not configured",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book"}},
                },
                "remedies": {"A": {"sample": {}}},
            },
            "$.remedies.A.sample",
            "at least one section",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book"}},
                },
                "remedies": {"A": {"sample": {"Mind": []}}},
            },
            "$.remedies.A.sample.Mind",
            "non-empty array",
        ),
        (
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "x",
                    "books": {"sample": {"title": "Sample Book"}},
                },
                "remedies": {"A": {"sample": {"Mind": ["ok", ""]}}},
            },
            "$.remedies.A.sample.Mind[1]",
            "non-empty string",
        ),
    ],
)
def test_rejects_invalid_combined_data(
    tmp_path: Path, value: object, location: str, message: str
) -> None:
    path = tmp_path / "combined.json"
    write_json(path, value)

    with pytest.raises(CorpusValidationError) as error:
        load_combined_books(path, definitions(sample="Sample Book"))

    assert "combined.json" in str(error.value)
    assert location in str(error.value)
    assert message in str(error.value)
