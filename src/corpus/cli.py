from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from corpus.builder import build_release
from corpus.chunking import chunk_book, corpus_hash
from corpus.config import PipelineConfig, load_pipeline_config
from corpus.embeddings import OpenRouterEmbeddingProvider
from corpus.sources import load_combined_books


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
        description="Build and activate local HomeoRemedica RAG corpus releases.",
    )
    parser.add_argument("--config", type=Path, default=Path("corpus.toml"))
    commands = parser.add_subparsers(required=True)

    validate = commands.add_parser(
        "validate", help="validate the combined corpus source and chunking"
    )
    validate.set_defaults(command=_validate)

    build = commands.add_parser(
        "build", help="build, verify, and activate all per-book SQLite artifacts"
    )
    build.add_argument("corpus_version")
    _worker_argument(build)
    build.set_defaults(command=_build)
    return parser


def _worker_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--workers",
        type=_positive_int,
        default=32,
        help="maximum concurrent embedding requests (default: 32)",
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


def _build(config: PipelineConfig, arguments: argparse.Namespace) -> int:
    books = load_combined_books(config.combined_dataset, config.books)
    provider = OpenRouterEmbeddingProvider(config.embedding)
    release = build_release(
        books,
        provider,
        output_root=config.output_directory,
        spec=config.artifact_spec(arguments.corpus_version),
        chunking=config.chunking,
        manifest_schema_version=config.manifest_schema_version,
        embedding_workers=arguments.workers,
        progress=lambda message: print(message, file=sys.stderr, flush=True),
    )
    _print_json(
        {
            "active": str(config.output_directory / "active.json"),
            "artifacts": len(release.artifacts),
            "corpusHash": release.corpus_hash,
            "corpusVersion": release.corpus_version,
            "directory": str(release.release_directory),
        }
    )
    return 0


def _load_chunks(config: PipelineConfig):
    books = load_combined_books(config.combined_dataset, config.books)
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
