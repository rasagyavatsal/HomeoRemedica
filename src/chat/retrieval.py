"""Production query embedding and active-release search."""

from __future__ import annotations

from typing import Protocol

from shared.contracts import (
    MAX_RETRIEVAL_QUERY_CHARS,
    BookSummary,
    ChatRequest,
    ChatTurn,
    RetrievedSource,
)
from shared.errors import ChatFailure


class QueryEmbedder(Protocol):
    def embed_query(self, text: str) -> tuple[float, ...]: ...


class SearchableRelease(Protocol):
    @property
    def corpus_version(self) -> str: ...

    @property
    def model_input_limit(self) -> int: ...

    @property
    def books(self) -> tuple[BookSummary, ...]: ...

    def search(
        self,
        query: str,
        embedding: tuple[float, ...],
        *,
        book_ids: tuple[str, ...] | None,
        limit: int,
    ) -> tuple[RetrievedSource, ...]: ...


class ProductionRetriever:
    def __init__(self, corpus: SearchableRelease, embedder: QueryEmbedder) -> None:
        self._corpus = corpus
        self._embedder = embedder
        self.corpus_version = corpus.corpus_version

    @property
    def books(self) -> tuple[BookSummary, ...]:
        return self._corpus.books

    @property
    def model_input_limit(self) -> int:
        return self._corpus.model_input_limit

    def retrieve(self, request: ChatRequest, *, limit: int) -> tuple[RetrievedSource, ...]:
        recent = (*request.history[-4:], ChatTurn(role="user", content=request.message))
        query = "\n".join(turn.content for turn in recent)[-MAX_RETRIEVAL_QUERY_CHARS:]
        try:
            embedding = self._embedder.embed_query(query)
        except ChatFailure:
            raise
        except TimeoutError as error:
            raise ChatFailure(
                stage="embedding", kind="timeout", error_type=type(error).__name__
            ) from error
        except (OSError, RuntimeError) as error:
            raise ChatFailure(
                stage="embedding", kind="provider", error_type=type(error).__name__
            ) from error
        except Exception as error:
            raise ChatFailure(
                stage="embedding", kind="internal", error_type=type(error).__name__
            ) from error
        return self._corpus.search(query, embedding, book_ids=request.book_ids, limit=limit)
