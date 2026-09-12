from __future__ import annotations

from typing import Literal

ChatStage = Literal["embedding", "corpus_search", "answer_generation", "chat"]
FailureKind = Literal["timeout", "provider", "token_exhaustion", "internal"]


class TokenExhaustionError(RuntimeError):
    """The answer provider stopped because it reached the output token limit."""

    def __init__(self) -> None:
        super().__init__("chat response reached the output token limit")


class ChatFailure(RuntimeError):
    """A safe, classified failure from one stage of a chat request."""

    def __init__(
        self,
        *,
        stage: ChatStage,
        kind: FailureKind,
        error_type: str | None = None,
    ) -> None:
        self.stage = stage
        self.kind = kind
        self.error_type = error_type
        super().__init__(f"{stage} {kind} failure")
