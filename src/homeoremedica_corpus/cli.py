from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

from homeoremedica_corpus.builder import build_release
from homeoremedica_corpus.chunking import chunk_book, corpus_hash
from homeoremedica_corpus.config import PipelineConfig, load_pipeline_config
from homeoremedica_corpus.contracts import compatibility_from_artifact_spec
from homeoremedica_corpus.embeddings import VertexEmbeddingProvider
from homeoremedica_corpus.evaluation import (
    load_evaluation_dataset,
    load_evaluation_gate,
    record_evaluation,
    run_dimension_evaluation,
)
from homeoremedica_corpus.publication import CorpusPublisher
from homeoremedica_corpus.sources import load_books
from homeoremedica_corpus.storage import GoogleCloudObjectStore


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    try:
        config = load_pipeline_config(arguments.config)
        return int(arguments.command(config, arguments))
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="homeoremedica-corpus",
        description="Build and publish immutable HomeoRemedica RAG corpus releases.",
    )
    parser.add_argument("--config", type=Path, default=Path("corpus.toml"))
    commands = parser.add_subparsers(required=True)

    validate = commands.add_parser("validate", help="validate processed sources and chunking")
    validate.set_defaults(command=_validate)

    evaluate = commands.add_parser("evaluate", help="compare configured embedding dimensions")
    _vertex_arguments(evaluate)
    evaluate.add_argument(
        "--workers",
        type=_positive_int,
        default=32,
        help="maximum concurrent Vertex embedding requests (default: 32)",
    )
    evaluate.set_defaults(command=_evaluate)

    build = commands.add_parser("build", help="build all per-book SQLite artifacts")
    build.add_argument("corpus_version")
    _vertex_arguments(build)
    _worker_argument(build)
    build.set_defaults(command=_build)

    publish = commands.add_parser("publish", help="stage and activate a built release")
    publish.add_argument("corpus_version")
    publish.add_argument("--bucket", required=True)
    publish.set_defaults(command=_publish)

    rollback = commands.add_parser("rollback", help="activate an existing immutable manifest")
    rollback.add_argument("corpus_version")
    rollback.add_argument("--bucket", required=True)
    rollback.set_defaults(command=_rollback)
    return parser


def _vertex_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--project", help="Google Cloud project (defaults to ADC environment)")
    parser.add_argument(
        "--location", help="regional Vertex AI location (defaults to ADC environment)"
    )


def _worker_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--workers",
        type=_positive_int,
        default=32,
        help="maximum concurrent Vertex requests (default: 32)",
    )


def _validate(config: PipelineConfig, _arguments: argparse.Namespace) -> int:
    books, chunks = _load_chunks(config)
    _print_json(
        {
            "books": len(books),
            "chunks": len(chunks),
            "corpusHash": corpus_hash(chunks),
            "passages": sum(len(chunk.passage_indexes) for chunk in chunks),
        }
    )
    return 0


def _evaluate(config: PipelineConfig, arguments: argparse.Namespace) -> int:
    _, chunks = _load_chunks(config)
    dataset, dataset_digest = load_evaluation_dataset(config.evaluation_dataset)

    def provider_for(dimensions: int) -> VertexEmbeddingProvider:
        return VertexEmbeddingProvider(
            replace(config.embedding, dimensions=dimensions),
            project=arguments.project,
            location=arguments.location,
        )

    result = run_dimension_evaluation(
        dataset,
        chunks,
        provider_for,
        model=config.embedding.model,
        model_input_limit=config.embedding.model_input_limit,
        dimensions=config.evaluation_dimensions,
        corpus_hash=corpus_hash(chunks),
        dataset_sha256=dataset_digest,
        workers=arguments.workers,
        progress=lambda message: print(message, file=sys.stderr, flush=True),
    )
    gate = record_evaluation(config.evaluation_result, result)
    _print_json(gate.model_dump(mode="json", by_alias=True))
    return 0


def _build(config: PipelineConfig, arguments: argparse.Namespace) -> int:
    books = load_books(config.processed_directory, config.books)
    gate = load_evaluation_gate(config.evaluation_result)
    _, dataset_digest = load_evaluation_dataset(config.evaluation_dataset)
    if gate.dataset_sha256 != dataset_digest:
        raise ValueError("evaluation result does not match the configured versioned dataset")
    if gate.chosen_dimensions != config.embedding.dimensions:
        raise ValueError(
            "configured embedding dimensions do not match the smallest passing evaluation result"
        )
    provider = VertexEmbeddingProvider(
        config.embedding,
        project=arguments.project,
        location=arguments.location,
    )
    release = build_release(
        books,
        provider,
        output_root=config.output_directory,
        spec=config.artifact_spec(arguments.corpus_version),
        chunking=config.chunking,
        evaluation=gate,
        manifest_schema_version=config.manifest_schema_version,
        embedding_workers=arguments.workers,
        progress=lambda message: print(message, file=sys.stderr, flush=True),
    )
    _print_json(
        {
            "artifacts": len(release.artifacts),
            "corpusHash": release.corpus_hash,
            "corpusVersion": release.corpus_version,
            "directory": str(release.release_directory),
        }
    )
    return 0


def _publish(config: PipelineConfig, arguments: argparse.Namespace) -> int:
    service = _publisher(config, arguments.bucket)
    release = service.publish(config.output_directory / arguments.corpus_version)
    _print_json(
        {
            "corpusVersion": release.active.corpus_version,
            "manifestGeneration": release.manifest.generation,
            "manifestObject": release.manifest.name,
            "pointerGeneration": release.pointer.generation,
        }
    )
    return 0


def _rollback(config: PipelineConfig, arguments: argparse.Namespace) -> int:
    active = _publisher(config, arguments.bucket).rollback(arguments.corpus_version)
    _print_json(active.model_dump(mode="json", by_alias=True))
    return 0


def _publisher(config: PipelineConfig, bucket: str) -> CorpusPublisher:
    requirements = config.artifact_spec("requirements")
    return CorpusPublisher(
        GoogleCloudObjectStore(bucket),
        expected_book_ids=frozenset(config.books),
        expected_compatibility=compatibility_from_artifact_spec(requirements),
        expected_artifact_schema_version=config.artifact_schema_version,
        expected_manifest_schema_version=config.manifest_schema_version,
    )


def _load_chunks(config: PipelineConfig):
    books = load_books(config.processed_directory, config.books)
    chunks = tuple(chunk for book in books for chunk in chunk_book(book, config.chunking))
    return books, chunks


def _print_json(value: object) -> None:
    print(json.dumps(value, indent=2, sort_keys=True))


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())
