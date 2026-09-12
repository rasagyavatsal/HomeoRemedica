from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from chat.chat import BookSummary, ChatRequest, ChatResponse
from chat.errors import ChatFailure
from web.app import create_app


class StubService:
    books = (
        BookSummary(book_id="kent-lectures", title="Kent's Lectures", author="James Tyler Kent"),
    )

    def __init__(self) -> None:
        self.requests: list[ChatRequest] = []

    def chat(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        return ChatResponse(
            answer="Historical answer [1].",
            corpus_version="v1",
            model="test-model",
            sources=(),
        )


def test_books_and_chat_endpoints_use_the_existing_service_contract(tmp_path: Path) -> None:
    service = StubService()
    app = create_app(service=service, frontend_directory=tmp_path)

    with TestClient(app) as client:
        books = client.get("/api/books")
        response = client.post(
            "/api/chat",
            json={"message": "What is described?", "bookIds": ["kent-lectures"]},
        )

    assert books.status_code == 200
    assert books.json() == {
        "books": [
            {
                "bookId": "kent-lectures",
                "title": "Kent's Lectures",
                "author": "James Tyler Kent",
            }
        ]
    }
    assert response.status_code == 200
    assert response.json()["answer"] == "Historical answer [1]."
    assert service.requests[0].book_ids == ("kent-lectures",)


def test_app_builds_the_service_during_startup(monkeypatch, tmp_path: Path) -> None:
    service = StubService()
    calls: list[object] = []

    def fake_build_service(settings):
        calls.append(settings)
        return service

    monkeypatch.setattr("web.app.build_service", fake_build_service)

    with TestClient(create_app(frontend_directory=tmp_path)):
        pass

    assert len(calls) == 1
    assert calls[0].__class__.__name__ == "Settings"


def test_chat_endpoint_returns_a_client_error_for_an_unknown_book(tmp_path: Path) -> None:
    class FailingService(StubService):
        def chat(self, request: ChatRequest) -> ChatResponse:
            raise ValueError("unknown book IDs: missing")

    with TestClient(create_app(service=FailingService(), frontend_directory=tmp_path)) as client:
        response = client.post("/api/chat", json={"message": "question"})

    assert response.status_code == 400
    assert response.json() == {"detail": "unknown book IDs: missing"}


@pytest.mark.parametrize(
    ("stage", "kind", "status_code", "detail"),
    [
        (
            "embedding",
            "provider",
            502,
            "The chat service is temporarily unavailable. Please try again shortly.",
        ),
        (
            "corpus_search",
            "internal",
            500,
            "Something went wrong while preparing the answer. Please try again.",
        ),
        (
            "answer_generation",
            "timeout",
            504,
            "The request took too long to complete. Please try again.",
        ),
    ],
)
def test_chat_endpoint_maps_failures_and_logs_safe_stage_metadata(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    stage: str,
    kind: str,
    status_code: int,
    detail: str,
) -> None:
    class FailingService(StubService):
        def chat(self, request: ChatRequest) -> ChatResponse:
            raise ChatFailure(
                stage=stage,  # type: ignore[arg-type]
                kind=kind,  # type: ignore[arg-type]
                error_type="RuntimeError",
            )

    caplog.set_level(logging.ERROR, logger="web.app")
    with TestClient(create_app(service=FailingService(), frontend_directory=tmp_path)) as client:
        response = client.post("/api/chat", json={"message": "question"})

    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert f"chat {stage.replace('_', ' ')} failed" in caplog.text
    assert kind in caplog.text
    assert "question" not in caplog.text


def test_chat_endpoint_keeps_unexpected_error_details_out_of_the_response_and_logs(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret = "provider response secret"

    class FailingService(StubService):
        def chat(self, request: ChatRequest) -> ChatResponse:
            raise Exception(secret)

    caplog.set_level(logging.ERROR, logger="web.app")
    with TestClient(create_app(service=FailingService(), frontend_directory=tmp_path)) as client:
        response = client.post("/api/chat", json={"message": "question"})

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Something went wrong while preparing the answer. Please try again."
    }
    assert secret not in response.text
    assert secret not in caplog.text
    assert "error_type=Exception" in caplog.text


def test_built_frontend_is_served_from_the_root(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>HomeoRemedica</html>", encoding="utf-8")

    with TestClient(create_app(service=StubService(), frontend_directory=tmp_path)) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert response.text == "<html>HomeoRemedica</html>"
