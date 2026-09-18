"""Interactive terminal chat using experimental retrieval."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from eval_chat.chat_runtime import build_service, load_books
from eval_chat.config import load_evaluation_config
from shared.terminal import run_cli


def _configure_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", type=Path, default=Path("evaluation.toml"))


def main(argv: Sequence[str] | None = None) -> int:
    return run_cli(
        argv,
        prog="eval-chat",
        description="Chat with the experimental HomeoRemedica retrieval pipeline.",
        build_service=lambda arguments: build_service(
            load_evaluation_config(arguments.config),
            progress=lambda message: print(message, file=sys.stderr),
        ),
        load_books=lambda arguments: load_books(load_evaluation_config(arguments.config)),
        configure_parser=_configure_parser,
    )


if __name__ == "__main__":
    raise SystemExit(main())
