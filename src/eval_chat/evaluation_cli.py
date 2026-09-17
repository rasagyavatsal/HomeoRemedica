from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

from corpus.chunking import chunk_book, corpus_hash
from corpus.sources import load_corpus_books
from eval_chat.config import EvaluationConfig, load_evaluation_config
from eval_chat.embeddings import OpenRouterEmbeddingProvider
from eval_chat.evaluation import (
    load_evaluation_dataset,
    record_evaluation,
    run_dimension_evaluation,
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    try:
        config = load_evaluation_config(arguments.config)
        _, chunks = _load_chunks(config)
        dataset, query_digest = load_evaluation_dataset(config.dataset, config.retrieval)

        def provider_for(dimensions: int) -> OpenRouterEmbeddingProvider:
            return OpenRouterEmbeddingProvider(replace(config.embedding, dimensions=dimensions))

        result = run_dimension_evaluation(
            dataset,
            chunks,
            provider_for,
            model=config.embedding.model,
            model_input_limit=config.embedding.model_input_limit,
            dimensions=config.dimensions,
            corpus_hash=corpus_hash(chunks),
            query_sha256=query_digest,
            embedding_cache_directory=config.cache_directory,
            workers=arguments.workers,
            progress=lambda message: print(message, file=sys.stderr, flush=True),
        )
        gate = record_evaluation(config.result, result)
        print(json.dumps(gate.model_dump(mode="json", by_alias=True), indent=2, sort_keys=True))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="evaluation",
        description="Run isolated retrieval experiments against the source dataset.",
    )
    parser.add_argument("--config", type=Path, default=Path("evaluation.toml"))
    parser.add_argument(
        "--workers",
        type=_positive_int,
        default=32,
        help="maximum concurrent embedding requests (default: 32)",
    )
    return parser


def _load_chunks(config: EvaluationConfig):
    books = load_corpus_books(config.corpus_dataset, config.books)
    chunks = tuple(chunk for book in books for chunk in chunk_book(book, config.chunking))
    return books, chunks


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())
