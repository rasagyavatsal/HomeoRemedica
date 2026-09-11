from __future__ import annotations

from pathlib import Path

from corpus.cli import _parser as corpus_parser
from corpus.config import load_pipeline_config
from corpus.embeddings import OpenRouterEmbeddingProvider as ReleaseEmbeddingProvider
from eval.cli import _parser as evaluation_parser
from eval.config import load_evaluation_config
from eval.embeddings import (
    OpenRouterEmbeddingProvider as EvaluationEmbeddingProvider,
)
from scripts.check_public_boundary import pipeline_violations

ROOT = Path(__file__).resolve().parents[1]


def test_evaluation_is_outside_the_chat_release_dependency_graph() -> None:
    assert pipeline_violations() == ()


def test_evaluation_has_a_separate_command_surface() -> None:
    corpus_commands = corpus_parser()._subparsers._group_actions[0].choices

    assert "evaluate" not in corpus_commands
    assert evaluation_parser().prog == "homeoremedica-evaluation"


def test_pipelines_share_only_the_source_dataset_by_configuration() -> None:
    release = load_pipeline_config(ROOT / "corpus.toml")
    evaluation = load_evaluation_config(ROOT / "evaluation.toml")

    assert release.combined_dataset == evaluation.combined_dataset
    assert ReleaseEmbeddingProvider is not EvaluationEmbeddingProvider
    assert release.output_directory != evaluation.result.parent
    assert not evaluation.cache_directory.is_relative_to(release.output_directory)
