from __future__ import annotations

import json
from pathlib import Path

import pytest

from homeoremedica_corpus.sources import (
    BookDefinition,
    CorpusValidationError,
    load_books,
)


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def definitions(**titles: str) -> dict[str, BookDefinition]:
    return {book_id: BookDefinition(title=title) for book_id, title in titles.items()}


def test_loads_only_direct_processed_json_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    processed = tmp_path / "dataset" / "processed"
    expected = processed / "sample.json"
    write_json(expected, {"Original Name": {"Mind": ["  Preserve me.  "]}})
    write_json(tmp_path / "dataset" / "raw-text" / "trap.json", {"trap": []})
    write_json(tmp_path / "review" / "trap.json", {"trap": []})
    write_json(tmp_path / "output" / "trap.json", {"trap": []})
    (processed / "notes.txt").write_text("ignore", encoding="utf-8")

    reads: list[Path] = []
    original_read_bytes = Path.read_bytes

    def record_read(path: Path) -> bytes:
        reads.append(path)
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", record_read)

    books = load_books(processed, definitions(sample="Sample Book"))

    assert reads == [expected]
    assert books[0].book_id == "sample"
    assert books[0].remedies[0].name == "Original Name"
    assert books[0].remedies[0].sections[0].passages == ("  Preserve me.  ",)


@pytest.mark.parametrize(
    ("value", "location", "message"),
    [
        ({}, "$", "non-empty object"),
        ({" ": {"Mind": ["text"]}}, "$[' ']", "remedy name"),
        ({"A": {}}, "$.A", "at least one section"),
        ({"A": {" ": ["text"]}}, "$.A[' ']", "section title"),
        ({"A": {"Mind": "text"}}, "$.A.Mind", "non-empty array"),
        ({"A": {"Mind": []}}, "$.A.Mind", "non-empty array"),
        ({"A": {"Mind": [""]}}, "$.A.Mind[0]", "non-empty string"),
        ({"A": {"Mind": [42]}}, "$.A.Mind[0]", "non-empty string"),
    ],
)
def test_rejects_invalid_sectioned_data(
    tmp_path: Path, value: object, location: str, message: str
) -> None:
    processed = tmp_path / "processed"
    write_json(processed / "sample.json", value)

    with pytest.raises(CorpusValidationError) as error:
        load_books(processed, definitions(sample="Sample Book"))

    assert "sample.json" in str(error.value)
    assert location in str(error.value)
    assert message in str(error.value)


def test_rejects_missing_unconfigured_and_symlinked_books(tmp_path: Path) -> None:
    processed = tmp_path / "processed"
    write_json(processed / "one.json", {"A": {"Mind": ["text"]}})
    write_json(processed / "extra.json", {"B": {"Mind": ["text"]}})

    with pytest.raises(CorpusValidationError, match="configuration does not match"):
        load_books(processed, definitions(one="One", missing="Missing"))

    outside = tmp_path / "outside.json"
    write_json(outside, {"C": {"Mind": ["text"]}})
    (processed / "linked.json").symlink_to(outside)
    with pytest.raises(CorpusValidationError, match="symbolic link"):
        load_books(
            processed,
            definitions(one="One", extra="Extra", linked="Linked"),
        )
