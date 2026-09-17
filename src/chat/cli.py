"""Terminal interface for the local corpus chat service."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from typing import TextIO

from pydantic import ValidationError

from chat.chat import (
    MAX_HISTORY_CHARS,
    MAX_HISTORY_TURNS,
    BookSummary,
    ChatRequest,
    ChatResponse,
    ChatService,
    ChatTurn,
)
from chat.errors import ChatFailure
from chat.runtime import Settings, build_service, load_corpus

_FAILURE_DETAILS = {
    "timeout": "The request took too long. Please try again.",
    "provider": "The chat provider is temporarily unavailable. Please try again shortly.",
    "token_exhaustion": "Response limit reached. Please try again.",
    "internal": "Something went wrong while preparing the answer. Please try again.",
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="chat",
        description="Chat with the active local HomeoRemedica corpus release.",
    )
    parser.add_argument(
        "message", nargs="*", help="ask one question and exit; omit to chat interactively"
    )
    parser.add_argument(
        "--book", action="append", default=[], metavar="BOOK_ID",
        help="limit retrieval to a book (repeat for up to four books)",
    )
    parser.add_argument("--list-books", action="store_true", help="show books in the active corpus")
    arguments = parser.parse_args(argv)

    try:
        settings = Settings()
        if arguments.list_books:
            _print_books(load_corpus(settings).books, sys.stdout)
            return 0
        service = build_service(settings)
        book_ids = tuple(arguments.book) or None
        # Apply the same bounds as the public chat contract before entering the loop.
        ChatRequest(message="book selection", book_ids=book_ids)
        known = {book.book_id for book in service.books}
        unknown = set(book_ids or ()) - known
        if unknown:
            raise ValueError(f"unknown book IDs: {', '.join(sorted(unknown))}")
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if arguments.message:
        return _ask(service, " ".join(arguments.message), (), book_ids, sys.stdout, sys.stderr)[0]

    print(f"HomeoRemedica · corpus {service.corpus_version} · {service.model_name}")
    print("Type /books to list books, /clear to reset the conversation, or /quit to exit.")
    history: tuple[ChatTurn, ...] = ()
    while True:
        try:
            if sys.stdin.isatty():
                print("You: ", end="", flush=True)
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            print(file=sys.stdout)
            return 130
        if not line:
            return 0
        message = line.strip()
        if not message:
            continue
        if message in {"/quit", "/exit"}:
            return 0
        if message == "/clear":
            history = ()
            print("Conversation cleared.")
            continue
        if message == "/books":
            _print_books(service.books, sys.stdout)
            continue
        if message.startswith("/"):
            print("Unknown command. Use /books, /clear, or /quit.", file=sys.stderr)
            continue
        _, history = _ask(service, message, history, book_ids, sys.stdout, sys.stderr)


def _ask(
    service: ChatService,
    message: str,
    history: tuple[ChatTurn, ...],
    book_ids: tuple[str, ...] | None,
    output: TextIO,
    errors: TextIO,
) -> tuple[int, tuple[ChatTurn, ...]]:
    try:
        request = ChatRequest(message=message, history=history, book_ids=book_ids)
        response = service.chat(request)
    except ValidationError as error:
        print(f"error: {error.errors()[0]['msg']}", file=errors)
        return 1, history
    except ValueError as error:
        print(f"error: {error}", file=errors)
        return 1, history
    except ChatFailure as error:
        print(f"error: {_FAILURE_DETAILS[error.kind]}", file=errors)
        return 1, history
    except Exception:
        print(f"error: {_FAILURE_DETAILS['internal']}", file=errors)
        return 1, history

    _print_response(response, output)
    turns = (
        *history,
        ChatTurn(role="user", content=request.message),
        ChatTurn(role="assistant", content=response.answer[:4_000]),
    )
    return 0, _trim_history(turns)


def _trim_history(turns: tuple[ChatTurn, ...]) -> tuple[ChatTurn, ...]:
    recent = turns[-MAX_HISTORY_TURNS:]
    while sum(len(turn.content) for turn in recent) > MAX_HISTORY_CHARS:
        recent = recent[1:]
    return recent


def _print_response(response: ChatResponse, output: TextIO) -> None:
    print(f"\n{response.answer}", file=output)
    if response.sources:
        print("\nSources:", file=output)
        for number, source in enumerate(response.sources, start=1):
            location = f"{source.book_title} — {source.remedy_name} — {source.section_title}"
            print(f"[{number}] {location} ({source.id})", file=output)
    print(file=output)


def _print_books(books: tuple[BookSummary, ...], output: TextIO) -> None:
    for book in books:
        author = f" — {book.author}" if book.author else ""
        print(f"{book.book_id}: {book.title}{author}", file=output)


if __name__ == "__main__":
    raise SystemExit(main())
