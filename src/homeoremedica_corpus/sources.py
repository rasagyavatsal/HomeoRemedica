from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class CorpusValidationError(ValueError):
    """Raised when source data cannot safely enter the corpus pipeline."""


@dataclass(frozen=True, slots=True)
class BookDefinition:
    title: str
    author: str | None = None


@dataclass(frozen=True, slots=True)
class Section:
    title: str
    passages: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Remedy:
    name: str
    sections: tuple[Section, ...]


@dataclass(frozen=True, slots=True)
class Book:
    book_id: str
    title: str
    author: str | None
    source_path: Path
    source_sha256: str
    remedies: tuple[Remedy, ...]


COMBINED_SCHEMA_VERSION = 1


def load_combined_books(
    path: Path,
    definitions: dict[str, BookDefinition],
) -> tuple[Book, ...]:
    """Load and validate the combined remedy-merged corpus file as the pipeline source.

    The combined file groups passages by remedy and then by source book, so it is
    restructured into one validated ``Book`` per configured book ID. Content must be
    conserved exactly; the file supplies every passage consumed by the pipeline.
    """
    if path.is_symlink():
        raise CorpusValidationError(f"Combined corpus file must not be a symbolic link: {path}")
    if not path.is_file():
        raise CorpusValidationError(f"Combined corpus file does not exist: {path}")

    contents = path.read_bytes()
    value = _parse_json(path, contents)
    if not isinstance(value, dict) or set(value) != {"metadata", "remedies"}:
        _invalid(path, "$", "top level must contain exactly 'metadata' and 'remedies' objects")
    _validate_combined_metadata(path, value["metadata"], definitions)

    remedies_by_book = {book_id: {} for book_id in definitions}
    for remedy_name, books_value in value["remedies"].items():
        remedy_location = _child_location("$.remedies", remedy_name)
        if not isinstance(remedy_name, str) or not remedy_name.strip():
            _invalid(path, remedy_location, "remedy name must be a non-empty string")
        if not isinstance(books_value, dict) or not books_value:
            _invalid(path, remedy_location, "remedy must contain at least one book")
        for book_id, sections_value in books_value.items():
            book_location = _child_location(remedy_location, book_id)
            if book_id not in definitions:
                _invalid(path, book_location, "book is not configured in corpus.toml")
            if not isinstance(sections_value, dict) or not sections_value:
                _invalid(path, book_location, "book must contain at least one section")
            remedies_by_book[book_id][remedy_name] = _validate_sections(
                path, book_location, sections_value
            )
    for book_id in sorted(definitions):
        if not remedies_by_book[book_id]:
            _invalid(path, "$.remedies", f"book {book_id!r} must contain at least one remedy")

    return tuple(
        Book(
            book_id=book_id,
            title=definitions[book_id].title,
            author=definitions[book_id].author,
            source_path=path,
            source_sha256=hashlib.sha256(contents).hexdigest(),
            remedies=tuple(
                Remedy(name=name, sections=remedies_by_book[book_id][name])
                for name in remedies_by_book[book_id]
            ),
        )
        for book_id in sorted(definitions)
    )


def _validate_combined_metadata(
    path: Path,
    metadata: Any,
    definitions: dict[str, BookDefinition],
) -> None:
    metadata_keys = {"schema_version", "generated_at", "books"}
    if not isinstance(metadata, dict) or set(metadata) != metadata_keys:
        _invalid(
            path,
            "$.metadata",
            "must contain exactly 'schema_version', 'generated_at', and 'books'",
        )
    if metadata["schema_version"] != COMBINED_SCHEMA_VERSION:
        _invalid(path, "$.metadata.schema_version", f"must be {COMBINED_SCHEMA_VERSION}")
    if not isinstance(metadata["generated_at"], str) or not metadata["generated_at"].strip():
        _invalid(path, "$.metadata.generated_at", "must be a non-empty string")
    books = metadata["books"]
    if not isinstance(books, dict) or set(books) != set(definitions):
        _invalid(path, "$.metadata.books", "must match the configured book IDs exactly")
    for book_id, book_value in books.items():
        location = _child_location("$.metadata.books", book_id)
        definition = definitions[book_id]
        if not isinstance(book_value, dict) or not (
            set(book_value) == {"title"} or set(book_value) == {"title", "author"}
        ):
            _invalid(path, location, "must contain a title and an optional author")
        if book_value["title"] != definition.title:
            _invalid(path, f"{location}.title", "must match the configured display title")
        author = book_value.get("author")
        if author != definition.author:
            _invalid(path, f"{location}.author", "must match the configured author")


def _validate_sections(
    path: Path, parent: str, sections_value: dict[str, Any]
) -> tuple[Section, ...]:
    sections = []
    for section_title, passages_value in sections_value.items():
        section_location = _child_location(parent, section_title)
        if not isinstance(section_title, str) or not section_title.strip():
            _invalid(path, section_location, "section title must be a non-empty string")
        if not isinstance(passages_value, list) or not passages_value:
            _invalid(path, section_location, "section must be a non-empty array")
        for index, passage in enumerate(passages_value):
            if not isinstance(passage, str) or not passage.strip():
                _invalid(path, f"{section_location}[{index}]", "passage must be a non-empty string")
        sections.append(Section(title=section_title, passages=tuple(passages_value)))
    return tuple(sections)


def _parse_json(path: Path, contents: bytes) -> Any:
    try:
        return json.loads(contents.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CorpusValidationError(f"{path.name}: invalid UTF-8 JSON: {error}") from error


def _child_location(parent: str, key: object) -> str:
    if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        return f"{parent}.{key}"
    return f"{parent}[{key!r}]"


def _invalid(path: Path, location: str, message: str) -> None:
    raise CorpusValidationError(f"{path.name}:{location}: {message}")
