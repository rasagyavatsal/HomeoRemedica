from __future__ import annotations

import io
import sys

import pytest

from chat.cli import main
from shared.contracts import BookSummary, ChatRequest, ChatResponse, Citation
from shared.errors import ChatFailure


class StubService:
    corpus_version = "local-v1"
    model_name = "test-model"
    books = (BookSummary(book_id="kent-lectures", title="Kent's Lectures", author="Kent"),)

    def __init__(self) -> None:
        self.requests: list[ChatRequest] = []
        self.fail = False

    def chat(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if self.fail:
            raise ChatFailure(stage="embedding", kind="provider", error_type="RuntimeError")
        return ChatResponse(
            answer="Historical reference only.\n\nKent describes irritability [1].",
            corpus_version=self.corpus_version,
            model=self.model_name,
            sources=(
                Citation(
                    id="local-v1/kent-lectures/chunk-1",
                    book_id="kent-lectures",
                    book_title="Kent's Lectures",
                    author="Kent",
                    remedy_name="NUX VOMICA",
                    section_title="MIND",
                    passage_indexes=(1,),
                    text="A passage.",
                ),
            ),
        )


def test_one_shot_chat_calls_local_service_and_prints_sources(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    service = StubService()
    monkeypatch.setattr("chat.cli.build_service", lambda settings: service)

    result = main(["--book", "kent-lectures", "What", "about", "irritability?"])

    out, err = capsys.readouterr()
    assert result == 0
    assert err == ""
    assert service.requests[0].message == "What about irritability?"
    assert service.requests[0].book_ids == ("kent-lectures",)
    assert "Kent describes irritability [1]." in out
    assert "[1] Kent's Lectures — NUX VOMICA — MIND" in out


def test_interactive_chat_keeps_history_and_clear_resets_it(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    service = StubService()
    monkeypatch.setattr("chat.cli.build_service", lambda settings: service)
    monkeypatch.setattr(sys, "stdin", io.StringIO("First?\nSecond?\n/clear\nThird?\n/quit\n"))

    assert main([]) == 0

    assert service.requests[0].history == ()
    assert [turn.role for turn in service.requests[1].history] == ["user", "assistant"]
    assert service.requests[1].history[0].content == "First?"
    assert service.requests[2].history == ()
    assert "Conversation cleared." in capsys.readouterr().out


def test_failed_question_does_not_enter_history(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    service = StubService()
    monkeypatch.setattr("chat.cli.build_service", lambda settings: service)
    monkeypatch.setattr(sys, "stdin", io.StringIO("First?\nSecond?\n"))

    original_chat = service.chat

    def fail_once(request: ChatRequest) -> ChatResponse:
        if request.message == "First?":
            service.requests.append(request)
            raise ChatFailure(stage="embedding", kind="provider", error_type="RuntimeError")
        return original_chat(request)

    service.chat = fail_once  # type: ignore[method-assign]

    assert main([]) == 0
    assert service.requests[1].history == ()
    assert "provider is temporarily unavailable" in capsys.readouterr().err


def test_unknown_book_fails_before_chat(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    service = StubService()
    monkeypatch.setattr("chat.cli.build_service", lambda settings: service)

    assert main(["--book", "missing", "question"]) == 1
    assert service.requests == []
    assert "unknown book IDs: missing" in capsys.readouterr().err


def test_list_books_only_loads_the_local_corpus(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    service = StubService()
    monkeypatch.setattr("chat.cli.load_corpus", lambda settings: service)

    def unexpected_build(settings: object) -> None:
        raise AssertionError("chat model should not be created")

    monkeypatch.setattr("chat.cli.build_service", unexpected_build)

    assert main(["--list-books"]) == 0
    assert "kent-lectures: Kent's Lectures — Kent" in capsys.readouterr().out
