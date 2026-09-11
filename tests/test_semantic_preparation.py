from __future__ import annotations

import numpy as np
import pytest

from eval.retrieval import score_semantic_queries
from scripts.prepare_semantic_candidates import _open_vectors, exhaustive_cosine_top_k


@pytest.mark.parametrize("block_size", [1, 2, 5])
def test_exhaustive_blocks_match_sqlite_cosine_search(block_size) -> None:
    documents = np.array([[0, 3, 1], [4, 2, 0], [-3, 0, 1], [1, 5, 2]], dtype=np.float32)
    queries = np.array([[1, 1, 0.2], [0.1, 0.2, 2]], dtype=np.float32)
    original_documents, original_queries = documents.copy(), queries.copy()
    chunk_ids = ("a", "b", "c", "d")
    expected = score_semantic_queries(
        chunk_ids, documents.tolist(), queries.tolist(), dimensions=3, limit=3
    )
    indexes, scores = exhaustive_cosine_top_k(documents, queries, limit=3, block_size=block_size)
    for row, ranking, values in zip(indexes, expected, scores, strict=True):
        assert tuple(chunk_ids[int(index)] for index in row) == tuple(c.chunk_id for c in ranking)
        np.testing.assert_allclose(values, [c.score for c in ranking], atol=1e-6)
    np.testing.assert_array_equal(documents, original_documents)
    np.testing.assert_array_equal(queries, original_queries)


def test_exhaustive_search_caps_pool_and_rejects_invalid_vectors() -> None:
    indexes, scores = exhaustive_cosine_top_k(np.eye(2), np.array([[1, 2]]), limit=10, block_size=1)
    assert indexes.tolist() == [[1, 0]]
    assert scores.shape == (1, 2)
    for invalid in ([[0, 0]], [[float("nan"), 1]], [[float("inf"), 1]]):
        with pytest.raises(ValueError, match="finite, nonzero"):
            exhaustive_cosine_top_k(np.array(invalid), np.eye(2), limit=1)
        with pytest.raises(ValueError, match="finite, nonzero"):
            exhaustive_cosine_top_k(np.eye(2), np.array(invalid), limit=1)
    with pytest.raises(ValueError, match="positive"):
        exhaustive_cosine_top_k(np.eye(2), np.eye(2), limit=0)
    with pytest.raises(ValueError, match="matching vector dimensions"):
        exhaustive_cosine_top_k(np.eye(2), np.eye(3), limit=1)


def test_vector_cache_rejects_truncated_or_extra_data(tmp_path) -> None:
    path = tmp_path / "vectors.f32"
    np.eye(2, dtype=np.float32).tofile(path)
    np.testing.assert_array_equal(_open_vectors(path, 2, 2), np.eye(2))
    with pytest.raises(ValueError, match="invalid byte size"):
        _open_vectors(path, 3, 2)
    with pytest.raises(ValueError, match="invalid byte size"):
        _open_vectors(path, 1, 2)
