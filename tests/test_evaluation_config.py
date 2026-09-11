from __future__ import annotations

from pathlib import Path

import pytest

from homeoremedica_evaluation.config import load_evaluation_config

CONFIG = """
[source]
combined_dataset = "dataset/combined.json"

[chunking]
minimum_tokens = 1
target_tokens = 1

[embedding]
model = "qwen/qwen3-embedding-8b"
native_dimensions = 4096
dimensions = [768, 1536, 4096]
model_input_limit = 32768

[output]
dataset = "evaluation/v1/queries.json"
result = "evaluation/v1/result.json"
cache_directory = ".cache/evaluation"

[books.sample]
title = "Sample Book"
author = "Sample Author"
"""


def test_loads_evaluation_owned_configuration_and_output_paths(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG)

    config = load_evaluation_config(path)

    assert config.combined_dataset == tmp_path / "dataset" / "combined.json"
    assert config.dataset == tmp_path / "evaluation" / "v1" / "queries.json"
    assert config.result == tmp_path / "evaluation" / "v1" / "result.json"
    assert config.cache_directory == tmp_path / ".cache" / "evaluation"
    assert config.dimensions == (768, 1536, 4096)
    assert config.embedding.dimensions == 4096
    assert config.books["sample"].title == "Sample Book"


def test_rejects_duplicate_evaluation_dimensions(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG.replace("[768, 1536, 4096]", "[768, 768]"))

    with pytest.raises(ValueError, match="unique"):
        load_evaluation_config(path)


def test_rejects_evaluation_results_or_caches_in_release_output(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG.replace("evaluation/v1/result.json", "output/releases/result.json"))
    with pytest.raises(ValueError, match="evaluation directory"):
        load_evaluation_config(path)

    path.write_text(CONFIG.replace(".cache/evaluation", "output/releases"))
    with pytest.raises(ValueError, match=r"\.cache/evaluation"):
        load_evaluation_config(path)
