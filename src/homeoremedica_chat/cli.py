from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from homeoremedica_chat.chat import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_TURNS,
    ChatRequest,
    ChatResponse,
    ChatService,
    ChatTurn,
)
from homeoremedica_chat.runtime import Settings, build_service, sync_corpus


def main(argv: Sequence[str] | None = None) -> int:
    """Run the HomeoRemedica terminal client."""

    parser = _parser()
    args = parser.parse_args(argv)
    try:
        settings = _settings(args)
        if args.command == "sync":
            corpus = sync_corpus(settings)
            print(
                f"Cached corpus {corpus.corpus_version} "
                f"({len(corpus.book_ids)} books) in {settings.cache_dir}"
            )
            return 0

        service = build_service(settings, sync=not args.cached)
        book_ids = tuple(args.books) if args.books else None
        if args.command == "ask":
            _print_response(service.chat(ChatRequest(message=args.message, book_ids=book_ids)))
            return 0
        if args.command == "chat":
            _interactive(service, book_ids)
            return 0
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # pragma: no cover - provider SDK errors vary by release.
        print(f"error: {error}", file=sys.stderr)
        return 1
    parser.error(f"unsupported command: {args.command}")
    return 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="homeoremedica",
        description="Ask grounded HomeoRemedica materia medica questions from a terminal.",
        epilog=(
            "Examples: homeoremedica sync; "
            'homeoremedica --cached ask "How is Nux vomica described?"; '
            "homeoremedica chat"
        ),
    )
    parser.add_argument("--project", help="authorized Google Cloud project")
    parser.add_argument("--location", help="Vertex AI region (default: us-central1)")
    parser.add_argument("--bucket", help="private corpus bucket")
    parser.add_argument("--cache-dir", type=Path, help="local verified corpus cache")
    parser.add_argument(
        "--cached",
        action="store_true",
        help="use the existing verified cache without checking Cloud Storage",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("sync", help="download and verify the active corpus release")

    ask = commands.add_parser("ask", help="ask one question and exit")
    ask.add_argument("message")
    _book_filter(ask)

    chat = commands.add_parser("chat", help="start an interactive terminal conversation")
    _book_filter(chat)
    return parser


def _book_filter(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--book",
        dest="books",
        action="append",
        help="limit retrieval to a book ID; repeat for multiple books",
    )


def _settings(args: argparse.Namespace) -> Settings:
    settings = Settings()
    overrides = {
        key: value
        for key, value in {
            "project": args.project,
            "location": args.location,
            "bucket": args.bucket,
            "cache_dir": args.cache_dir,
        }.items()
        if value is not None
    }
    return settings.model_copy(update=overrides)


def _interactive(service: ChatService, book_ids: tuple[str, ...] | None) -> None:
    """Run a conversation whose context lives only for this process."""

    history: list[ChatTurn] = []
    print("HomeoRemedica chat. Type /exit to leave or /clear to reset the conversation.")
    while True:
        try:
            message = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if message in {"/exit", "/quit"}:
            return
        if message == "/clear":
            history.clear()
            print("Conversation cleared.")
            continue
        if not message:
            continue
        response = service.chat(
            ChatRequest(message=message, history=tuple(history), book_ids=book_ids)
        )
        print("\nAssistant: ", end="")
        _print_response(response)
        history.extend((
            ChatTurn(role="user", content=message),
            ChatTurn(role="assistant", content=response.answer),
        ))
        _trim_history(history)


def _trim_history(history: list[ChatTurn]) -> None:
    """Keep the next interactive request within the chat validation budget."""

    while (
        len(history) > MAX_HISTORY_TURNS
        or sum(len(turn.content) for turn in history) > MAX_HISTORY_CHARS
    ):
        # Interactive turns are appended as user/assistant pairs. Drop a whole
        # pair so a follow-up never starts with an orphaned assistant answer.
        del history[:2]


def _print_response(response: ChatResponse) -> None:
    print(response.answer)
    print(f"\nSources (corpus {response.corpus_version}):")
    for index, source in enumerate(response.sources, start=1):
        print(f"[{index}] {source.book_title} — {source.remedy_name} — {source.section_title}")
        print(f"    {source.id}")


if __name__ == "__main__":
    raise SystemExit(main())
