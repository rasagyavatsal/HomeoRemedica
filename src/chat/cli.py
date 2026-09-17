"""Production terminal chat entry point."""

from __future__ import annotations

from collections.abc import Sequence

from chat.runtime import Settings, build_service, load_corpus
from shared.terminal import run_cli


def main(argv: Sequence[str] | None = None) -> int:
    return run_cli(
        argv,
        prog="chat",
        description="Chat with the active local HomeoRemedica corpus release.",
        build_service=lambda _arguments: build_service(Settings()),
        load_books=lambda _arguments: load_corpus(Settings()).books,
    )


if __name__ == "__main__":
    raise SystemExit(main())
