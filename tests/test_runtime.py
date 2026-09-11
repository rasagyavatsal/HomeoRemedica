from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from chat.runtime import DEFAULT_ZAI_BASE_URL, Settings, ZaiChatClient


class FakeResponse:
    def __init__(self, payload: object, *, status_code: int = 200, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> object:
        return self._payload


class FakeSession:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        return self.response


def test_settings_defaults_to_glm_flash_and_reads_zai_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ZAI_API_KEY", "zai-key")
    monkeypatch.delenv("RAG_CORPUS_DIR", raising=False)

    settings = Settings()

    assert settings.model == "glm-5.3-flash"
    assert settings.zai_api_key == "zai-key"
    assert settings.corpus_dir == Path("artifacts/corpus")


def test_settings_reads_the_local_corpus_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAG_CORPUS_DIR", "~/homeoremedica-corpus")

    assert Settings().corpus_dir == Path.home() / "homeoremedica-corpus"


def test_zai_client_sends_openai_compatible_chat_request() -> None:
    session = FakeSession(
        FakeResponse({"choices": [{"message": {"content": "Grounded answer."}}]})
    )
    client = ZaiChatClient(
        api_key="zai-key",
        model="glm-5.3-flash",
        max_output_tokens=700,
        session=session,
    )

    answer = client.generate("Retrieved evidence", system_instruction="Use citations.")

    assert answer == "Grounded answer."
    assert session.calls == [
        {
            "url": f"{DEFAULT_ZAI_BASE_URL}/chat/completions",
            "headers": {
                "Authorization": "Bearer zai-key",
                "Content-Type": "application/json",
            },
            "json": {
                "model": "glm-5.3-flash",
                "messages": [
                    {"role": "system", "content": "Use citations."},
                    {"role": "user", "content": "Retrieved evidence"},
                ],
                "thinking": {"type": "enabled"},
                "reasoning_effort": "max",
                "temperature": 1.0,
                "max_tokens": 700,
                "stream": False,
            },
            "timeout": 60.0,
        }
    ]


def test_zai_client_requires_a_key(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.delenv("ZAI_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValueError, match="ZAI_API_KEY"):
        ZaiChatClient(
            api_key=None,
            model="glm-5.3-flash",
            max_output_tokens=700,
            session=FakeSession(FakeResponse({})),
        )
