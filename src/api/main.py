"""Run from the repository root with ``uvicorn api.main:app``."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from production.corpus import CorpusError
from production.runtime import Settings, build_service, load_corpus
from shared.contracts import BookSummary, ChatRequest, ChatResponse, ChatTurn, Contract
from shared.conversation import advance_history
from shared.errors import FAILURE_DETAILS, ChatFailure
from shared.terminal import ChatSession

logger = logging.getLogger(__name__)
app = FastAPI(title="HomeoRemedica", version="6.0.0")
_service_lock = Lock()


class BookCatalog(Contract):
    books: tuple[BookSummary, ...]
    corpus_version: str
    model: str


class WebChatResponse(ChatResponse):
    history: tuple[ChatTurn, ...]


@lru_cache(maxsize=1)
def get_catalog() -> BookCatalog:
    settings = Settings()
    corpus = load_corpus(settings)
    return BookCatalog(
        books=corpus.books, corpus_version=corpus.corpus_version, model=settings.model
    )


@lru_cache(maxsize=1)
def get_service() -> ChatSession:
    return build_service(Settings())


def _setup_failure(error: Exception) -> HTTPException:
    if isinstance(error, CorpusError):
        detail = (
            "The production corpus is unavailable. Build or activate a compatible release, "
            "check RAG_CORPUS_DIR, then restart the API."
        )
    else:
        detail = (
            "The production chat is not configured. Check OPENROUTER_API_KEY, ZAI_API_KEY "
            "and the RAG_ settings in .env, then restart the API."
        )
    return HTTPException(status_code=503, detail=detail)


@app.exception_handler(RequestValidationError)
def validation_error(_request: Request, error: RequestValidationError) -> JSONResponse:
    # Return the useful validation message without echoing a user's history or input.
    return JSONResponse(status_code=422, content={"detail": error.errors()[0]["msg"]})


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/books", response_model=BookCatalog)
def books() -> BookCatalog:
    try:
        return get_catalog()
    except (OSError, RuntimeError, ValueError) as error:
        raise _setup_failure(error) from None
    except Exception:
        logger.exception("Failed to load the production book catalog")
        raise HTTPException(status_code=500, detail=FAILURE_DETAILS["internal"]) from None


@app.post("/api/chat", response_model=WebChatResponse)
def chat(request: ChatRequest) -> WebChatResponse:
    # The production providers use requests.Session; serialize access to their cached clients.
    # Conversation state stays in the request and is never shared between browser sessions.
    with _service_lock:
        try:
            service = get_service()
        except (OSError, RuntimeError, ValueError) as error:
            raise _setup_failure(error) from None
        except Exception:
            logger.exception("Failed to initialize production chat")
            raise HTTPException(status_code=500, detail=FAILURE_DETAILS["internal"]) from None

        unknown = set(request.book_ids or ()) - {book.book_id for book in service.books}
        if unknown:
            raise HTTPException(
                status_code=400, detail=f"unknown book IDs: {', '.join(sorted(unknown))}"
            )
        try:
            response = service.chat(request)
            return WebChatResponse(
                **response.model_dump(),
                history=advance_history(request.history, request.message, response.answer),
            )
        except ChatFailure as error:
            status_code = {"timeout": 504, "provider": 502, "token_exhaustion": 502}.get(
                error.kind, 500
            )
            raise HTTPException(
                status_code=status_code, detail=FAILURE_DETAILS[error.kind]
            ) from None
        except Exception:
            logger.exception("Production chat failed")
            raise HTTPException(status_code=500, detail=FAILURE_DETAILS["internal"]) from None


# A built frontend can be served by Uvicorn alone. During development Vite proxies /api.
web_dist = Path(__file__).resolve().parents[2] / "web" / "dist"
if (web_dist / "index.html").is_file():
    app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
