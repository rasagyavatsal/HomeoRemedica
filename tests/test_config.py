from __future__ import annotations

from pathlib import Path

import pytest

from corpus.config import load_pipeline_config

CONFIG = """
[corpus]
combined_dataset = "dataset/combined.json"
output_directory = "output/releases"
artifact_schema_version = 1
manifest_schema_version = 1
sqlite_version = "3.53.4"
sqlite_vec_version = "0.1.9"

[chunking]
minimum_tokens = 300
target_tokens = 500

[embedding]
model = "qwen/qwen3-embedding-8b"
native_dimensions = 4096
dimensions = 768
document_task_type = "RETRIEVAL_DOCUMENT"
query_task_type = "RETRIEVAL_QUERY"
normalization = "l2"
distance_function = "cosine"
model_input_limit = 32768

[books.sample]
title = "Sample Book"
author = "Sample Author"
"""


def test_loads_and_resolves_the_versioned_pipeline_configuration(tmp_path: Path) -> None:
    path = tmp_path / "corpus.toml"
    path.write_text(CONFIG)

    config = load_pipeline_config(path)

    assert config.combined_dataset == tmp_path / "dataset" / "combined.json"
    assert config.output_directory == tmp_path / "output" / "releases"
    assert config.books["sample"].title == "Sample Book"
    assert config.chunking.target_tokens == 500
    assert config.embedding.dimensions == 768
    artifact = config.artifact_spec("2026-08-14.test")
    assert artifact.sqlite_version == "3.53.4"
    assert artifact.sqlite_vec_version == "0.1.9"
    assert artifact.artifact_schema_version == 1


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        ("dimensions = 768", "dimensions = 5000", "less than or equal to 4096"),
        ('model = "qwen/qwen3-embedding-8b"', 'model = "other"', "qwen/qwen3-embedding-8b"),
        ("native_dimensions = 4096", "native_dimensions = 2048", "4096 native dimensions"),
        ('sqlite_vec_version = "0.1.9"', 'sqlite_vec_version = "1.0.0"', "pre-1.0"),
    ],
)
def test_rejects_incompatible_pipeline_settings(
    tmp_path: Path, old: str, new: str, message: str
) -> None:
    path = tmp_path / "corpus.toml"
    path.write_text(CONFIG.replace(old, new))

    with pytest.raises(ValueError, match=message):
        load_pipeline_config(path)
