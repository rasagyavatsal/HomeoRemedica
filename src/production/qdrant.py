"""Hybrid search over the Qdrant materia medica collection.

The collection is built by the HomeoRemedica-dataset repository: each chunk has a
voyage-4 dense vector and a BM25 sparse vector, and both rankings are fused with
reciprocal-rank fusion inside Qdrant.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from qdrant_client import QdrantClient, models

from shared.contracts import BookSummary, RetrievedSource

COLLECTION = "materia_medica"
DENSE_VECTOR = "dense"
SPARSE_VECTOR = "bm25"
SPARSE_MODEL = "Qdrant/bm25"
# Each ranking contributes this many candidates per requested source before fusion.
PREFETCH_MULTIPLIER = 5
# voyage-4 accepts 32,000 input tokens.
MODEL_INPUT_LIMIT = 32_000

# Book IDs are the collection's ``source`` payload values.
BOOKS = (
    BookSummary(
        book_id="allen",
        title="Allen, The Materia Medica of the Nosodes",
        author="H. C. Allen",
    ),
    BookSummary(
        book_id="boericke",
        title="Boericke, Homoeopathic Materia Medica",
        author="William Boericke",
    ),
    BookSummary(
        book_id="clarke",
        title="Clarke, A Dictionary of Practical Materia Medica",
        author="John Henry Clarke",
    ),
    BookSummary(
        book_id="kent",
        title="Kent, Lectures on Homoeopathic Materia Medica",
        author="James Tyler Kent",
    ),
)


class CorpusError(RuntimeError):
    """The Qdrant collection is missing or unreachable."""


class SparseQueryEncoder(Protocol):
    def encode_query(self, text: str) -> models.SparseVector: ...


class Bm25QueryEncoder:
    """Encode queries with the same fastembed BM25 model used to index the collection."""

    def __init__(self, model_name: str = SPARSE_MODEL) -> None:
        self._model_name = model_name
        self._model: Any | None = None

    def encode_query(self, text: str) -> models.SparseVector:
        model = self._model
        if model is None:
            # Importing fastembed loads onnxruntime; defer it until the first search.
            from fastembed import SparseTextEmbedding

            model = self._model = SparseTextEmbedding(self._model_name)
        embedding = next(iter(model.query_embed(text)))
        return models.SparseVector(
            indices=embedding.indices.tolist(), values=embedding.values.tolist()
        )


class QdrantCorpus:
    def __init__(
        self,
        client: QdrantClient,
        sparse_encoder: SparseQueryEncoder,
        *,
        collection: str = COLLECTION,
    ) -> None:
        self._client = client
        self._sparse_encoder = sparse_encoder
        self._collection = collection

    @property
    def corpus_version(self) -> str:
        return self._collection

    @property
    def model_input_limit(self) -> int:
        return MODEL_INPUT_LIMIT

    @property
    def books(self) -> tuple[BookSummary, ...]:
        return BOOKS

    def verify(self) -> None:
        try:
            exists = self._client.collection_exists(self._collection)
        except Exception as error:
            raise CorpusError(f"could not reach Qdrant: {type(error).__name__}") from error
        if not exists:
            raise CorpusError(f"Qdrant collection {self._collection!r} does not exist")

    def search(
        self,
        query: str,
        embedding: tuple[float, ...],
        *,
        book_ids: tuple[str, ...] | None,
        limit: int,
    ) -> tuple[RetrievedSource, ...]:
        query_filter = (
            models.Filter(
                must=[
                    models.FieldCondition(key="source", match=models.MatchAny(any=list(book_ids)))
                ]
            )
            if book_ids
            else None
        )
        candidates = limit * PREFETCH_MULTIPLIER
        points = self._client.query_points(
            self._collection,
            prefetch=[
                models.Prefetch(
                    query=list(embedding),
                    using=DENSE_VECTOR,
                    filter=query_filter,
                    limit=candidates,
                ),
                models.Prefetch(
                    query=self._sparse_encoder.encode_query(query),
                    using=SPARSE_VECTOR,
                    filter=query_filter,
                    limit=candidates,
                ),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            limit=limit,
            with_payload=True,
            with_vectors=False,
        ).points
        return tuple(_source(point.payload or {}, point.score) for point in points)


def _source(payload: Mapping[str, Any], score: float) -> RetrievedSource:
    group = payload.get("section_group")
    sections = "; ".join(s for s in payload.get("sections") or () if s != group)
    return RetrievedSource(
        chunk_id=str(payload["chunk_id"]),
        book_id=str(payload["source"]),
        book_title=str(payload["source_title"]),
        author=payload.get("author"),
        remedy_name=str(payload["remedy"]),
        section_title=f"{group}: {sections}" if group and sections else group or sections,
        passage_indexes=(int(payload["chunk_index"]),),
        text=str(payload["content"]),
        score=score,
    )
