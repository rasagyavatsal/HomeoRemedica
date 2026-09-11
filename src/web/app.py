from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles

from chat.chat import BookSummary, ChatRequest, ChatResponse, ChatService, Contract
from chat.runtime import Settings, build_service

FRONTEND_DIRECTORY = Path(__file__).resolve().parents[2] / "frontend" / "dist"


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
        try:
            return _service(request).chat(payload)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except (OSError, RuntimeError) as error:
            raise HTTPException(
                status_code=502,
                detail="The chat service is unavailable",
            ) from error

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
