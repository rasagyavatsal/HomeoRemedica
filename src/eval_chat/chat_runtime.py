"""Build interactive chat from the evaluation dataset and retrieval settings."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import replace

from corpus.chunking import chunk_book, corpus_hash
from corpus.sources import load_corpus_books
from eval_chat.chat_retrieval import ExperimentalRetriever
from eval_chat.config import EvaluationConfig
from eval_chat.document_cache import ensure_document_cache, read_document_vectors
from eval_chat.embeddings import OpenRouterEmbeddingProvider, preflight_embedding_inputs
from eval_chat.evaluation import _embedding_cache_path
from eval_chat.retrieval import PreparedRetrievalIndex
from shared.contracts import BookSummary
from shared.generation import ZaiChatClient
from shared.service import ChatService


def load_books(evaluation: EvaluationConfig) -> tuple[BookSummary, ...]:
    return tuple(
        BookSummary(book_id=book.book_id, title=book.title, author=book.author)
        for book in load_corpus_books(evaluation.corpus_dataset, evaluation.books)
    )


def build_service(
    evaluation: EvaluationConfig,
    *,
    progress: Callable[[str], None] | None = None,
) -> ChatService:
    chat = evaluation.chat
    if chat is None:
        raise ValueError("evaluation config has no [chat] section")
    if chat.dimensions not in evaluation.dimensions:
        raise ValueError(
            f"eval-chat dimensions {chat.dimensions} are not configured in evaluation.toml"
        )
    generator = ZaiChatClient(
        api_key=None,
        model=chat.model,
        max_output_tokens=chat.max_output_tokens,
    )
    books = load_corpus_books(evaluation.corpus_dataset, evaluation.books)
    chunks = tuple(chunk for book in books for chunk in chunk_book(book, evaluation.chunking))
    if not chunks:
        raise ValueError("evaluation source corpus contains no chunks")
    provider = OpenRouterEmbeddingProvider(
        replace(evaluation.embedding, dimensions=chat.dimensions)
    )
    if progress is not None:
        progress(f"Preparing {len(chunks)} experimental chunks at {chat.dimensions} dimensions")
    preflight_embedding_inputs(chunks, provider, evaluation.embedding.model_input_limit)
    document_inputs = tuple(chunk.embedding_text for chunk in chunks)
    document_cache = _embedding_cache_path(
        evaluation.cache_directory,
        "documents",
        evaluation.embedding.model,
        chat.dimensions,
        document_inputs,
    )
    assert document_cache is not None
    ensure_document_cache(
        chunks,
        provider,
        document_cache,
        dimensions=chat.dimensions,
        progress=progress,
    )
    if progress is not None:
        progress("Loading or building the experimental search index")
    fingerprint = hashlib.sha256(
        (
            "eval-chat-index-v1"
            + corpus_hash(chunks)
            + evaluation.retrieval.model_dump_json()
            + evaluation.embedding.model
            + str(chat.dimensions)
        ).encode("utf-8")
    ).hexdigest()[:12]
    index = PreparedRetrievalIndex(
        chunks,
        read_document_vectors(document_cache, count=len(chunks), dimensions=chat.dimensions),
        dimensions=chat.dimensions,
        cache_path=evaluation.cache_directory / f"interactive-{fingerprint}.sqlite",
        cache_key=fingerprint,
    )
    retriever = ExperimentalRetriever(
        books=books,
        chunks=chunks,
        index=index,
        embedder=provider,
        settings=evaluation.retrieval,
        corpus_version=f"eval-{fingerprint}",
        model_input_limit=evaluation.embedding.model_input_limit,
    )
    if progress is not None:
        progress("Experimental retrieval is ready")
    return ChatService(
        retriever=retriever, generator=generator, source_limit=evaluation.retrieval.k
    )
