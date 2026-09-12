from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

from chat.chat import BookSummary, ChatRequest, ChatResponse, ChatService, Contract
from chat.errors import ChatFailure
from chat.runtime import Settings, build_service

FRONTEND_DIRECTORY = Path(__file__).resolve().parents[2] / "frontend" / "dist"
logger = logging.getLogger(__name__)

_FAILURE_STATUS_CODES = {
    "timeout": 504,
    "provider": 502,
    "internal": 500,
}
_FAILURE_DETAILS = {
    "timeout": "The request took too long to complete. Please try again.",
    "provider": "The chat service is temporarily unavailable. Please try again shortly.",
    "internal": "Something went wrong while preparing the answer. Please try again.",
}


class BooksResponse(Contract):
    books: tuple[BookSummary, ...]


def create_app(
    service: ChatService | None = None,
    *,
    settings: Settings | None = None,
    frontend_directory: Path = FRONTEND_DIRECTORY,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):  # noqa: RUF029 - required by FastAPI.
        application.state.service = (
            service
            if service is not None
            else build_service(settings if settings is not None else Settings())
        )
        yield

    application = FastAPI(title="HomeoRemedica", lifespan=lifespan)

    @application.get("/api/books", response_model=BooksResponse)
    def available_books(request: Request) -> BooksResponse:
        return BooksResponse(books=_service(request).books)

    @application.post("/api/chat", response_model=ChatResponse)
    def chat(request: Request, payload: ChatRequest) -> ChatResponse:
        service_for_request = _service(request)
        try:
            return service_for_request.chat(payload)
        except ChatFailure as error:
            _log_chat_failure(error)
            status_code = _FAILURE_STATUS_CODES[error.kind]
            raise HTTPException(
                status_code=status_code,
                detail=_FAILURE_DETAILS[error.kind],
            ) from None
        except TimeoutError as error:
            failure = ChatFailure(
                stage="chat",
                kind="timeout",
                error_type=type(error).__name__,
            )
            _log_chat_failure(failure)
            raise HTTPException(
                status_code=_FAILURE_STATUS_CODES["timeout"],
                detail=_FAILURE_DETAILS["timeout"],
            ) from None
        except (OSError, RuntimeError) as error:
            failure = ChatFailure(
                stage="chat",
                kind="provider",
                error_type=type(error).__name__,
            )
            _log_chat_failure(failure)
            raise HTTPException(
                status_code=_FAILURE_STATUS_CODES["provider"],
                detail=_FAILURE_DETAILS["provider"],
            ) from None
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except Exception as error:
            logger.error(
                "chat request failed: stage=chat kind=internal error_type=%s",
                type(error).__name__,
                extra={
                    "chat_stage": "chat",
                    "failure_kind": "internal",
                    "error_type": type(error).__name__,
                },
            )
            raise HTTPException(
                status_code=500,
                detail=_FAILURE_DETAILS["internal"],
            ) from None

    if frontend_directory.is_dir():
        application.mount(
            "/",
            StaticFiles(directory=frontend_directory, html=True),
            name="frontend",
        )

    return application


def _service(request: Request) -> ChatService:
    try:
        return request.app.state.service
    except AttributeError as error:
        raise HTTPException(status_code=503, detail="The chat service is starting") from error


def _log_chat_failure(error: ChatFailure) -> None:
    stage = error.stage.replace("_", " ")
    error_type = error.error_type or "unknown"
    operation = "chat request" if stage == "chat" else f"chat {stage}"
    logger.error(
        "%s failed: kind=%s error_type=%s",
        operation,
        error.kind,
        error_type,
        extra={
            "chat_stage": error.stage,
            "failure_kind": error.kind,
            "error_type": error_type,
        },
    )


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run(
        "web.app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
    )


if __name__ == "__main__":
    main()
