from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from qdrant_client import models

from production.embeddings import VOYAGE_DIMENSIONS, VoyageQueryEmbedder
from production.qdrant import CorpusError, QdrantCorpus

SPARSE = models.SparseVector(indices=[7, 11], values=[1.0, 1.0])
PAYLOAD = {
    "chunk_id": "clarke-00042",
    "source": "clarke",
    "source_title": "Clarke, A Dictionary of Practical Materia Medica",
    "author": "John Henry Clarke",
    "remedy": "Nux Vomica",
    "section_group": "Symptoms",
    "sections": ["Mind", "Head"],
    "chunk_index": 3,
    "content": "Irritable, oversensitive to noise.",
    "text": "Clarke > Nux Vomica > Mind; Head\n\nIrritable, oversensitive to noise.",
}


class FakeClient:
    def __init__(self, *, exists: bool | Exception = True) -> None:
        self.exists = exists
        self.calls: list[dict[str, Any]] = []

    def collection_exists(self, collection: str) -> bool:
        if isinstance(self.exists, Exception):
            raise self.exists
        return self.exists

    def query_points(self, collection: str, **kwargs: Any) -> SimpleNamespace:
        self.calls.append({"collection": collection, **kwargs})
        return SimpleNamespace(points=[SimpleNamespace(payload=PAYLOAD, score=0.5)])


class FakeEncoder:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def encode_query(self, text: str) -> models.SparseVector:
        self.queries.append(text)
        return SPARSE


def corpus(client: FakeClient, encoder: FakeEncoder | None = None) -> QdrantCorpus:
    return QdrantCorpus(client, encoder or FakeEncoder())  # type: ignore[arg-type]


def test_search_fuses_dense_and_bm25_rankings_with_a_book_filter() -> None:
    client = FakeClient()
    encoder = FakeEncoder()

    sources = corpus(client, encoder).search(
        "irritability", (0.1, 0.2), book_ids=("clarke", "kent"), limit=8
    )

    [call] = client.calls
    expected_filter = models.Filter(
        must=[models.FieldCondition(key="source", match=models.MatchAny(any=["clarke", "kent"]))]
    )
    assert call["collection"] == "materia_medica"
    assert call["limit"] == 8
    assert call["query"] == models.FusionQuery(fusion=models.Fusion.RRF)
    dense, sparse = call["prefetch"]
    assert (dense.using, dense.query, dense.limit) == ("dense", [0.1, 0.2], 40)
    assert (sparse.using, sparse.query, sparse.limit) == ("bm25", SPARSE, 40)
    assert dense.filter == sparse.filter == expected_filter
    assert encoder.queries == ["irritability"]

    [source] = sources
    assert source.chunk_id == "clarke-00042"
    assert source.book_id == "clarke"
    assert source.remedy_name == "Nux Vomica"
    assert source.section_title == "Symptoms: Mind; Head"
    assert source.passage_indexes == (3,)
    assert source.text == "Irritable, oversensitive to noise."
    assert source.score == 0.5


def test_search_without_books_is_unfiltered() -> None:
    client = FakeClient()

    corpus(client).search("question", (1.0,), book_ids=None, limit=2)

    assert all(prefetch.filter is None for prefetch in client.calls[0]["prefetch"])


def test_catalog_book_ids_are_valid_request_ids() -> None:
    from shared.contracts import ChatRequest

    book_ids = tuple(book.book_id for book in corpus(FakeClient()).books)

    assert book_ids == ("allen", "boericke", "clarke", "kent")
    assert ChatRequest(message="question", book_ids=book_ids).book_ids == book_ids


@pytest.mark.parametrize(
    ("exists", "message"),
    [(False, "does not exist"), (ConnectionError("secret host"), "could not reach")],
)
def test_verify_reports_a_missing_or_unreachable_collection(
    exists: bool | Exception, message: str
) -> None:
    with pytest.raises(CorpusError, match=message) as error:
        corpus(FakeClient(exists=exists)).verify()

    assert "secret host" not in str(error.value)


class FakeResponse:
    def __init__(self, payload: object, *, status_code: int = 200) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> object:
        return self._payload


class FakeSession:
    def __init__(self, *responses: FakeResponse) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return self.responses.pop(0)


def test_query_embedder_requests_voyage_query_vectors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("production.embeddings.time.sleep", lambda _seconds: None)
    vector = [0.5] * VOYAGE_DIMENSIONS
    session = FakeSession(
        FakeResponse({}, status_code=429),
        FakeResponse({"data": [{"index": 0, "embedding": vector}]}),
    )

    embedding = VoyageQueryEmbedder(api_key="key", session=session).embed_query("question")

    assert embedding == tuple(vector)
    assert len(session.calls) == 2
    assert session.calls[0]["json"] == {
        "model": "voyageai/voyage-4",
        "input": ["question"],
        "input_type": "query",
        "dimensions": VOYAGE_DIMENSIONS,
        "encoding_format": "float",
    }
    assert session.calls[0]["headers"] == {"Authorization": "Bearer key"}


def test_query_embedder_rejects_wrong_dimensions() -> None:
    session = FakeSession(FakeResponse({"data": [{"embedding": [0.1, 0.2]}]}))

    with pytest.raises(RuntimeError, match="1024 dimensions"):
        VoyageQueryEmbedder(api_key="key", session=session).embed_query("question")


def test_query_embedder_requires_a_key() -> None:
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        VoyageQueryEmbedder(api_key=None)
