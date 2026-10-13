from __future__ import annotations

from typing import Literal

ChatStage = Literal["embedding", "corpus_search", "answer_generation", "chat"]
FailureKind = Literal["timeout", "provider", "token_exhaustion", "internal"]

FAILURE_DETAILS: dict[FailureKind, str] = {
    "timeout": "The request took too long. Please try again.",
    "provider": "The chat provider is temporarily unavailable. Please try again shortly.",
    "token_exhaustion": "Response limit reached. Please try again.",
    "internal": "Something went wrong while preparing the answer. Please try again.",
}


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
        self.stage: ChatStage = stage
        self.kind: FailureKind = kind
        self.error_type = error_type
        super().__init__(f"{stage} {kind} failure")
