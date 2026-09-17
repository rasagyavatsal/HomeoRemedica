"""Adapt experimental rankings into sourced interactive chat results."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from corpus.chunking import Chunk
from corpus.sources import Book
from eval_chat.evaluation import (
    SCORE_FUSION_EXPONENT,
    EvaluationSettings,
    _normalized_score_fusion,
    _ranking_id,
    _rankings_for_unit,
    _scored_rankings_for_unit,
)
from eval_chat.retrieval import (
    PreparedRetrievalIndex,
    ScoredCandidate,
    lexical_content_terms,
    reciprocal_rank_fusion,
)
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


class ExperimentalRetriever:
    def __init__(
        self,
        *,
        books: Sequence[Book],
        chunks: Sequence[Chunk],
        index: PreparedRetrievalIndex,
        embedder: QueryEmbedder,
        settings: EvaluationSettings,
        corpus_version: str,
        model_input_limit: int,
    ) -> None:
        self._books = tuple(
            BookSummary(book_id=book.book_id, title=book.title, author=book.author)
            for book in books
        )
        self._book_authors = {book.book_id: book.author for book in books}
        self._chunks = tuple(chunks)
        self._chunks_by_id = {chunk.id: chunk for chunk in chunks}
        self._ranking_ids = {
            chunk.id: _ranking_id(chunk, settings.ranking_unit, settings.remedy_name_normalization)
            for chunk in chunks
        }
        self._index = index
        self._embedder = embedder
        self._settings = settings
        self.corpus_version = corpus_version
        self.model_input_limit = model_input_limit

    @property
    def books(self) -> tuple[BookSummary, ...]:
        return self._books

    def retrieve(self, request: ChatRequest, *, limit: int) -> tuple[RetrievedSource, ...]:
        if limit <= 0:
            raise ValueError("source limit must be positive")
        selected_books = set(request.book_ids or (book.book_id for book in self._books))
        unknown = selected_books - set(self._book_authors)
        if unknown:
            raise ValueError(f"unknown book IDs: {', '.join(sorted(unknown))}")

        recent = (*request.history[-4:], ChatTurn(role="user", content=request.message))
        query = "\n".join(turn.content for turn in recent)[-MAX_RETRIEVAL_QUERY_CHARS:]
        instruction = self._settings.semantic_query_instruction
        semantic_query = f"Instruct: {instruction}\nQuery:{query}" if instruction else query
        lexical_query = (
            lexical_content_terms(query)
            if self._settings.lexical_query_mode == "contentTerms"
            else query
        )
        try:
            query_vector = self._embedder.embed_query(semantic_query)
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

        candidate_limit = (
            len(self._chunks)
            if request.book_ids
            else min(len(self._chunks), max(limit, self._settings.candidate_pool_size))
        )
        lexical = self._filter_books(
            self._index.score_lexical(lexical_query, limit=candidate_limit), selected_books
        )
        semantic = self._filter_books(
            self._index.score_semantic(query_vector, limit=candidate_limit), selected_books
        )
        if self._settings.fusion_strategy == "normalizedScore":
            semantic_units = _scored_rankings_for_unit((semantic,), self._ranking_ids)[0]
            lexical_units = _scored_rankings_for_unit((lexical,), self._ranking_ids)[0]
            ranked_units = _normalized_score_fusion(
                (semantic_units, lexical_units), SCORE_FUSION_EXPONENT
            )
        else:
            semantic_units = _rankings_for_unit(
                (tuple(item.chunk_id for item in semantic),),
                self._settings.ranking_unit,
                self._ranking_ids,
            )[0]
            lexical_units = _rankings_for_unit(
                (tuple(item.chunk_id for item in lexical),),
                self._settings.ranking_unit,
                self._ranking_ids,
            )[0]
            ranked_units = reciprocal_rank_fusion((semantic_units, lexical_units), rank_constant=60)

        representatives = self._representative_chunks(semantic, lexical)
        return tuple(
            self._as_source(representatives[unit], rank)
            for rank, unit in enumerate(ranked_units[:limit], start=1)
        )

    def _filter_books(
        self, candidates: Sequence[ScoredCandidate], selected: set[str]
    ) -> tuple[ScoredCandidate, ...]:
        return tuple(
            candidate
            for candidate in candidates
            if self._chunks_by_id[candidate.chunk_id].book_id in selected
        )

    def _representative_chunks(
        self,
        semantic: Sequence[ScoredCandidate],
        lexical: Sequence[ScoredCandidate],
    ) -> dict[str, Chunk]:
        best: dict[str, tuple[int, float, str]] = {}
        for ranking in (semantic, lexical):
            for rank, candidate in enumerate(ranking, start=1):
                unit = self._ranking_ids[candidate.chunk_id]
                key = (rank, -candidate.score, candidate.chunk_id)
                if unit not in best or key < best[unit]:
                    best[unit] = key
        return {unit: self._chunks_by_id[key[2]] for unit, key in best.items()}

    def _as_source(self, chunk: Chunk, rank: int) -> RetrievedSource:
        return RetrievedSource(
            chunk_id=chunk.id,
            book_id=chunk.book_id,
            book_title=chunk.book_title,
            author=self._book_authors[chunk.book_id],
            remedy_name=chunk.remedy_name,
            section_title=chunk.section_title,
            passage_indexes=chunk.passage_indexes,
            text=chunk.text,
            score=1.0 / rank,
        )
