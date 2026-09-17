from __future__ import annotations

from pathlib import Path

import pytest

from eval_chat.config import load_evaluation_config

CONFIG = """
[source]
corpus_dataset = "dataset/corpus.json"

[chunking]
minimum_tokens = 1
target_tokens = 1

[embedding]
model = "qwen/qwen3-embedding-8b"
native_dimensions = 4096
dimensions = [768, 1536, 4096]
model_input_limit = 32768

[retrieval]
k = 8
ranking_unit = "globalRemedy"
fusion_strategy = "normalizedScore"
remedy_name_normalization = "nfkcCasefoldWhitespace"
lexical_query_mode = "contentTerms"
semantic_query_instruction = "Retrieve matching passages."
candidate_pool_size = 640
quality_metric = "recallAtK"
minimum_quality = 0.8

[output]
dataset = "benchmarks/queries/v1.json"
result = "benchmarks/results/v1.json"
cache_directory = ".cache/benchmarks"

[books.sample]
title = "Sample Book"
author = "Sample Author"
"""


def test_loads_evaluation_owned_configuration_and_output_paths(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG)

    config = load_evaluation_config(path)

    assert config.corpus_dataset == tmp_path / "dataset" / "corpus.json"
    assert config.dataset == tmp_path / "benchmarks" / "queries" / "v1.json"
    assert config.result == tmp_path / "benchmarks" / "results" / "v1.json"
    assert config.cache_directory == tmp_path / ".cache" / "benchmarks"
    assert config.dimensions == (768, 1536, 4096)
    assert config.embedding.dimensions == 4096
    assert config.retrieval.ranking_unit == "globalRemedy"
    assert config.retrieval.candidate_pool_size == 640
    assert config.books["sample"].title == "Sample Book"


def test_rejects_duplicate_evaluation_dimensions(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG.replace("[768, 1536, 4096]", "[768, 768]"))

    with pytest.raises(ValueError, match="unique"):
        load_evaluation_config(path)


def test_rejects_evaluation_results_or_caches_in_release_output(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG.replace("benchmarks/results/v1.json", "artifacts/corpus/result.json"))
    with pytest.raises(ValueError, match="benchmark directory"):
        load_evaluation_config(path)

    path.write_text(CONFIG.replace(".cache/benchmarks", "artifacts/corpus"))
    with pytest.raises(ValueError, match=r"\.cache/benchmarks"):
        load_evaluation_config(path)


def test_rejects_swapped_query_and_result_collections(tmp_path: Path) -> None:
    path = tmp_path / "evaluation.toml"
    path.write_text(CONFIG.replace("benchmarks/queries/v1.json", "benchmarks/results/v1.json"))
    with pytest.raises(ValueError, match="benchmarks/queries"):
        load_evaluation_config(path)

    path.write_text(CONFIG.replace("benchmarks/results/v1.json", "benchmarks/queries/v1.json"))
    with pytest.raises(ValueError, match="benchmarks/results"):
        load_evaluation_config(path)
