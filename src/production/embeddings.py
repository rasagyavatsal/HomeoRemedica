"""voyage-4 query embeddings through OpenRouter."""

from __future__ import annotations

import time
from typing import Any

import requests

DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
VOYAGE_EMBEDDING_MODEL = "voyageai/voyage-4"
VOYAGE_DIMENSIONS = 1024

_RETRYABLE_STATUS_CODES = frozenset({408, 409, 429, 500, 502, 503, 504})
_MAX_ATTEMPTS = 3
_INITIAL_BACKOFF_SECONDS = 1.0


class VoyageQueryEmbedder:
    """Embed search queries to match the collection's voyage-4 document vectors."""

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str = DEFAULT_OPENROUTER_BASE_URL,
        session: Any | None = None,
        timeout: float = 30.0,
    ) -> None:
        if not api_key:
            raise ValueError(
                "an OpenRouter API key is required; set OPENROUTER_API_KEY in the environment "
                "or .env"
            )
        self._url = f"{base_url.rstrip('/')}/embeddings"
        self._session = session or requests.Session()
        self._timeout = timeout
        self._headers = {"Authorization": f"Bearer {api_key}"}

    def embed_query(self, text: str) -> tuple[float, ...]:
        payload = {
            "model": VOYAGE_EMBEDDING_MODEL,
            "input": [text],
            "input_type": "query",
            "dimensions": VOYAGE_DIMENSIONS,
            "encoding_format": "float",
        }
        backoff = _INITIAL_BACKOFF_SECONDS
        attempt = 1
        while True:
            response = self._post(payload)
            if response.status_code == 200:
                return _parse_embedding(response)
            if response.status_code not in _RETRYABLE_STATUS_CODES or attempt == _MAX_ATTEMPTS:
                break
            time.sleep(backoff)
            backoff *= 2
            attempt += 1
        if response.status_code in {408, 504}:
            raise TimeoutError("OpenRouter embedding request timed out")
        raise RuntimeError(
            f"OpenRouter embedding request failed with status {response.status_code}"
        )

    def _post(self, payload: dict[str, Any]) -> Any:
        try:
            return self._session.post(
                self._url, headers=self._headers, json=payload, timeout=self._timeout
            )
        except (requests.Timeout, TimeoutError):
            raise TimeoutError("OpenRouter embedding request timed out") from None
        except requests.RequestException:
            raise RuntimeError("OpenRouter embedding request failed") from None


def _parse_embedding(response: Any) -> tuple[float, ...]:
    try:
        parsed = response.json()
    except ValueError:
        raise RuntimeError("OpenRouter returned an invalid JSON embedding response") from None
    data = parsed.get("data") if isinstance(parsed, dict) else None
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise RuntimeError("OpenRouter did not return exactly one embedding for one input")
    embedding = data[0].get("embedding")
    if not isinstance(embedding, list) or len(embedding) != VOYAGE_DIMENSIONS:
        raise RuntimeError(
            f"OpenRouter returned an embedding without {VOYAGE_DIMENSIONS} dimensions"
        )
    return tuple(float(value) for value in embedding)
