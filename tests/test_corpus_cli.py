from __future__ import annotations

import json
from pathlib import Path

from homeoremedica_corpus.cli import main

from .test_config import CONFIG


def test_validate_command_reports_source_and_chunk_counts(tmp_path: Path, capsys) -> None:
    config_path = tmp_path / "corpus.toml"
    config_path.write_text(CONFIG)
    combined = tmp_path / "dataset" / "combined.json"
    combined.parent.mkdir(parents=True)
    combined.write_text(
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
