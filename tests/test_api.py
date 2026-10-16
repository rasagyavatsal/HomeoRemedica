from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api import main as api
from production.corpus import CorpusError
from shared.contracts import BookSummary, ChatRequest, ChatResponse, Citation
from shared.errors import ChatFailure, FailureKind

ROOT = Path(__file__).resolve().parents[1]
BOOK = BookSummary(book_id="kent-lectures", title="Kent's Lectures", author="Kent")


class StubService:
    corpus_version = "local-v1"
    model_name = "test-model"
    books = (BOOK,)

    def __init__(self) -> None:
        self.requests: list[ChatRequest] = []
        self.failure: Exception | None = None
        self.answer = "Historical reference only. Kent describes irritability [1]."

    def chat(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        return ChatResponse(
            answer=self.answer,
            corpus_version=self.corpus_version,
            model=self.model_name,
            sources=(
                Citation(
                    id="local-v1/kent-lectures/chunk-1",
                    book_id=BOOK.book_id,
                    book_title=BOOK.title,
                    author=BOOK.author,
                    remedy_name="NUX VOMICA",
                    section_title="MIND",
                    passage_indexes=(1,),
                    text="A passage.",
                ),
            ),
        )


@pytest.fixture
def service(monkeypatch: pytest.MonkeyPatch) -> StubService:
    stub = StubService()
    monkeypatch.setattr(api, "get_service", lambda: stub)
    return stub


@pytest.fixture
def client() -> TestClient:
    return TestClient(api.app, raise_server_exceptions=False)


def test_health_needs_neither_corpus_nor_provider_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_setup() -> None:
        raise AssertionError("health must not initialize chat or load a corpus")

    monkeypatch.setattr(api, "get_catalog", unexpected_setup)
    monkeypatch.setattr(api, "get_service", unexpected_setup)

    with TestClient(api.app, raise_server_exceptions=False) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_books_uses_only_the_local_catalog(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = api.BookCatalog(books=(BOOK,), corpus_version="local-v1", model="test-model")
    monkeypatch.setattr(api, "get_catalog", lambda: catalog)

    def unexpected_setup() -> None:
        raise AssertionError("listing books must not construct chat providers")

    monkeypatch.setattr(api, "get_service", unexpected_setup)

    response = client.get("/api/books")

    assert response.status_code == 200
    assert response.json() == {
        "books": [{"bookId": BOOK.book_id, "title": BOOK.title, "author": BOOK.author}],
        "corpusVersion": "local-v1",
        "model": "test-model",
    }


def test_catalog_is_cached_without_constructing_chat_providers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loads: list[object] = []
    settings = SimpleNamespace(model="catalog-model")
    monkeypatch.setattr(api, "Settings", lambda: settings)

    def load(settings: object) -> StubService:
        loads.append(settings)
        return StubService()

    def unexpected_build(settings: object) -> None:
        raise AssertionError("catalog must not initialize chat providers")

    monkeypatch.setattr(api, "load_corpus", load)
    monkeypatch.setattr(api, "build_service", unexpected_build)
    api.get_catalog.cache_clear()
    try:
        first = api.get_catalog()
        second = api.get_catalog()

        assert first is second
        assert first.books == (BOOK,)
        assert first.model == "catalog-model"
        assert loads == [settings]
    finally:
        api.get_catalog.cache_clear()


def test_service_is_created_once_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    builds: list[object] = []
    settings = SimpleNamespace(model="test-model")
    stub = StubService()
    monkeypatch.setattr(api, "Settings", lambda: settings)

    def build(settings: object) -> StubService:
        builds.append(settings)
        return stub

    monkeypatch.setattr(api, "build_service", build)
    api.get_service.cache_clear()
    try:
        assert api.get_service() is stub
        assert api.get_service() is stub
        assert builds == [settings]
    finally:
        api.get_service.cache_clear()


def test_chat_forwards_filters_and_history_and_returns_citations(
    client: TestClient, service: StubService
) -> None:
    history = [
        {"role": "user", "content": "First question?"},
        {"role": "assistant", "content": "First answer."},
    ]

    response = client.post(
        "/api/chat",
        json={
            "message": "  What about irritability?  ",
            "bookIds": [BOOK.book_id],
            "history": history,
        },
    )

    assert response.status_code == 200
    assert len(service.requests) == 1
    request = service.requests[0]
    assert request.message == "What about irritability?"
    assert request.book_ids == (BOOK.book_id,)
    assert [turn.model_dump() for turn in request.history] == history
    body = response.json()
    assert body["answer"] == service.answer
    assert body["corpusVersion"] == "local-v1"
    assert body["model"] == "test-model"
    assert body["history"] == [
        *history,
        {"role": "user", "content": request.message},
        {"role": "assistant", "content": service.answer},
    ]
    assert body["sources"] == [
        {
            "id": "local-v1/kent-lectures/chunk-1",
            "bookId": BOOK.book_id,
            "bookTitle": BOOK.title,
            "author": BOOK.author,
            "remedyName": "NUX VOMICA",
            "sectionTitle": "MIND",
            "passageIndexes": [1],
            "text": "A passage.",
        }
    ]


def test_chat_with_an_empty_history_starts_a_new_conversation(
    client: TestClient, service: StubService
) -> None:
    first = client.post("/api/chat", json={"message": "First question?"})
    second = client.post("/api/chat", json={"message": "After clearing?", "history": []})

    assert first.status_code == second.status_code == 200
    assert service.requests[0].history == service.requests[1].history == ()
    assert service.requests[0].book_ids is None
    assert second.json()["history"][0]["content"] == "After clearing?"


def test_chat_retains_the_latest_twenty_history_turns(
    client: TestClient, service: StubService
) -> None:
    history = [
        {"role": "user" if number % 2 == 0 else "assistant", "content": f"old {number}"}
        for number in range(20)
    ]

    response = client.post("/api/chat", json={"message": "New question?", "history": history})

    assert response.status_code == 200
    retained = response.json()["history"]
    assert len(retained) == 20
    assert retained[:18] == history[2:]
    assert retained[-2:] == [
        {"role": "user", "content": "New question?"},
        {"role": "assistant", "content": service.answer},
    ]


def test_chat_limits_history_characters_and_truncates_answer_only_in_history(
    client: TestClient, service: StubService
) -> None:
    history = [{"role": "user", "content": character * 4_000} for character in "abcd"]
    service.answer = "answer " * 700

    response = client.post("/api/chat", json={"message": "New question?", "history": history})

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == service.answer
    assert body["history"] == [
        *history[2:],
        {"role": "user", "content": "New question?"},
        {"role": "assistant", "content": service.answer[:4_000].strip()},
    ]
    assert sum(len(turn["content"]) for turn in body["history"]) <= 16_000


@pytest.mark.parametrize(
    "payload",
    [
        {"message": "  "},
        {"message": "a" * 4_001},
        {"message": "question", "bookIds": []},
        {"message": "question", "bookIds": [f"book-{number}" for number in range(5)]},
        {"message": "question", "bookIds": ["../private"]},
        {"message": "question", "bookIds": [BOOK.book_id, BOOK.book_id]},
        {"message": "question", "history": [{"role": "system", "content": "hidden"}]},
        {"message": "question", "history": [{"role": "user", "content": "a"}] * 21},
        {"message": "question", "history": [{"role": "user", "content": "a" * 4_000}] * 5},
        {"message": "question", "unexpected": "field"},
    ],
)
def test_invalid_requests_are_rejected_before_chat(
    payload: dict[str, object], client: TestClient, service: StubService
) -> None:
    response = client.post("/api/chat", json=payload)

    assert response.status_code == 422
    assert service.requests == []


def test_unknown_book_is_rejected_before_chat(client: TestClient, service: StubService) -> None:
    response = client.post("/api/chat", json={"message": "question", "bookIds": ["unknown"]})

    assert response.status_code == 400
    assert response.json() == {"detail": "unknown book IDs: unknown"}
    assert service.requests == []


@pytest.mark.parametrize(
    ("kind", "status", "detail"),
    [
        ("timeout", 504, "The request took too long. Please try again."),
        (
            "provider",
            502,
            "The chat provider is temporarily unavailable. Please try again shortly.",
        ),
        ("token_exhaustion", 502, "Response limit reached. Please try again."),
        (
            "internal",
            500,
            "Something went wrong while preparing the answer. Please try again.",
        ),
    ],
)
def test_classified_failures_have_cli_friendly_details(
    kind: FailureKind, status: int, detail: str, client: TestClient, service: StubService
) -> None:
    service.failure = ChatFailure(stage="answer_generation", kind=kind, error_type="private-secret")

    response = client.post("/api/chat", json={"message": "question"})

    assert response.status_code == status
    assert response.json() == {"detail": detail}
    assert "private-secret" not in response.text


@pytest.mark.parametrize("failure", [RuntimeError("private-secret"), ValueError("private-secret")])
def test_unexpected_chat_errors_do_not_leak_details(
    failure: Exception, client: TestClient, service: StubService
) -> None:
    service.failure = failure

    response = client.post("/api/chat", json={"message": "question"})

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Something went wrong while preparing the answer. Please try again."
    }
    assert "private-secret" not in response.text


@pytest.mark.parametrize("endpoint", ["/api/books", "/api/chat"])
def test_unavailable_corpus_has_safe_actionable_detail(
    endpoint: str, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def missing_corpus() -> None:
        raise CorpusError("corpus directory does not exist: /private/secret/path")

    monkeypatch.setattr(api, "get_catalog", missing_corpus)
    monkeypatch.setattr(api, "get_service", missing_corpus)

    response = (
        client.get(endpoint)
        if endpoint == "/api/books"
        else client.post(endpoint, json={"message": "question"})
    )

    assert response.status_code == 503
    assert "corpus" in response.json()["detail"].lower()
    assert "RAG_CORPUS_DIR" in response.json()["detail"]
    assert "/private/secret/path" not in response.text


def test_missing_provider_configuration_has_safe_setup_detail(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def missing_key() -> None:
        raise ValueError("ZAI_API_KEY is required; private-secret")

    monkeypatch.setattr(api, "get_service", missing_key)

    response = client.post("/api/chat", json={"message": "question"})

    assert response.status_code == 503
    assert "ZAI_API_KEY" in response.json()["detail"]
    assert "private-secret" not in response.text


@pytest.mark.parametrize("endpoint", ["/api/books", "/api/chat"])
def test_unexpected_setup_errors_do_not_leak_details(
    endpoint: str, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_setup() -> None:
        raise TypeError("private-secret")

    monkeypatch.setattr(api, "get_catalog", broken_setup)
    monkeypatch.setattr(api, "get_service", broken_setup)

    response = (
        client.get(endpoint)
        if endpoint == "/api/books"
        else client.post(endpoint, json={"message": "question"})
    )

    assert response.status_code == 500
    assert response.json() == {
        "detail": "Something went wrong while preparing the answer. Please try again."
    }
    assert "private-secret" not in response.text


def test_api_has_no_experimental_imports() -> None:
    imports: list[str] = []
    for path in (ROOT / "src/api").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
            elif isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)

    assert any(name == "production.runtime" for name in imports)
    assert not any(name.partition(".")[0] == "experimental" for name in imports)
