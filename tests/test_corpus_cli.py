from __future__ import annotations

import json
from pathlib import Path

from corpus.cli import main
from corpus.contracts import ActivePointer

from .test_config import CONFIG


def test_validate_command_reports_source_and_chunk_counts(tmp_path: Path, capsys) -> None:
    config_path = tmp_path / "corpus.toml"
    config_path.write_text(CONFIG)
    corpus = tmp_path / "dataset" / "corpus.json"
    corpus.parent.mkdir(parents=True)
    corpus.write_text(
        json.dumps(
            {
                "metadata": {
                    "schema_version": 1,
                    "generated_at": "2026-09-05T06:39:00Z",
                    "books": {
                        "sample": {"title": "Sample Book", "author": "Sample Author"}
                    },
                },
                "remedies": {"A": {"sample": {"Mind": ["First passage.", "Second passage."]}}},
            }
        )
    )

    assert main(["--config", str(config_path), "validate"]) == 0

    output = json.loads(capsys.readouterr().out)
    assert output == {
        "books": 1,
        "chunks": 1,
        "corpusHash": output["corpusHash"],
        "passages": 2,
    }
    assert len(output["corpusHash"]) == 64


def test_activate_command_reports_the_verified_release_pointer(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    config_path = tmp_path / "corpus.toml"
    config_path.write_text(CONFIG)
    pointer = ActivePointer(
        corpus_version="v1",
        manifest_path="v1/manifest.json",
        manifest_byte_size=1,
        manifest_sha256="a" * 64,
    )
    monkeypatch.setattr("corpus.cli.activate_release", lambda _root, _version: pointer)

    assert main(["--config", str(config_path), "activate", "v1"]) == 0

    assert json.loads(capsys.readouterr().out) == {
        "active": str(tmp_path / "artifacts" / "corpus" / "active.json"),
        "corpusVersion": "v1",
        "manifest": str(tmp_path / "artifacts" / "corpus" / "v1" / "manifest.json"),
    }
