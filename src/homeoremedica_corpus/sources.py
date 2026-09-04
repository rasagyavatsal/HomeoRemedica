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


def load_books(
    processed_directory: Path,
    definitions: dict[str, BookDefinition],
) -> tuple[Book, ...]:
    """Load and validate exactly the configured direct processed JSON files."""
    if processed_directory.is_symlink():
        raise CorpusValidationError(
            f"Processed directory must not be a symbolic link: {processed_directory}"
        )
    if not processed_directory.is_dir():
        raise CorpusValidationError(f"Processed directory does not exist: {processed_directory}")

    paths = sorted(
        (path for path in processed_directory.iterdir() if path.suffix == ".json"),
        key=lambda path: path.name,
    )
    symlinks = [path.name for path in paths if path.is_symlink()]
    if symlinks:
        raise CorpusValidationError(
            "Processed data files must not be symbolic links: " + ", ".join(symlinks)
        )

    discovered = {path.stem for path in paths}
    configured = set(definitions)
    if discovered != configured:
        missing = sorted(configured - discovered)
        unconfigured = sorted(discovered - configured)
        raise CorpusValidationError(
            "Processed book configuration does not match dataset/processed/*.json "
            f"(missing={missing}, unconfigured={unconfigured})"
        )

    books = []
    for path in paths:
        definition = definitions[path.stem]
        if not definition.title.strip():
            raise CorpusValidationError(f"{path.name}: configured display title must be non-empty")
        if definition.author is not None and not definition.author.strip():
            raise CorpusValidationError(
                f"{path.name}: configured author must be non-empty when set"
            )
        contents = path.read_bytes()
        value = _parse_json(path, contents)
        books.append(
            Book(
                book_id=path.stem,
                title=definition.title,
                author=definition.author,
                source_path=path,
                source_sha256=hashlib.sha256(contents).hexdigest(),
                remedies=_validate_book(path, value),
            )
        )
    return tuple(books)


def _parse_json(path: Path, contents: bytes) -> Any:
    try:
        return json.loads(contents.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CorpusValidationError(f"{path.name}: invalid UTF-8 JSON: {error}") from error


def _validate_book(path: Path, value: Any) -> tuple[Remedy, ...]:
    if not isinstance(value, dict) or not value:
        _invalid(path, "$", "top level must be a non-empty object")

    remedies = []
    for remedy_name, sections_value in value.items():
        remedy_location = _child_location("$", remedy_name)
        if not isinstance(remedy_name, str) or not remedy_name.strip():
            _invalid(path, remedy_location, "remedy name must be a non-empty string")
        if not isinstance(sections_value, dict) or not sections_value:
            _invalid(path, remedy_location, "remedy must contain at least one section")

        sections = []
        for section_title, passages_value in sections_value.items():
            section_location = _child_location(remedy_location, section_title)
            if not isinstance(section_title, str) or not section_title.strip():
                _invalid(path, section_location, "section title must be a non-empty string")
            if not isinstance(passages_value, list) or not passages_value:
                _invalid(path, section_location, "section must be a non-empty array")
            for index, passage in enumerate(passages_value):
                if not isinstance(passage, str) or not passage.strip():
                    _invalid(
                        path,
                        f"{section_location}[{index}]",
                        "passage must be a non-empty string",
                    )
            sections.append(Section(title=section_title, passages=tuple(passages_value)))
        remedies.append(Remedy(name=remedy_name, sections=tuple(sections)))
    return tuple(remedies)


def _child_location(parent: str, key: object) -> str:
    if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        return f"{parent}.{key}"
    return f"{parent}[{key!r}]"


def _invalid(path: Path, location: str, message: str) -> None:
    raise CorpusValidationError(f"{path.name}:{location}: {message}")
