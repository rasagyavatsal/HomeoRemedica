from __future__ import annotations

from typing import Literal

ChatStage = Literal["embedding", "corpus_search", "answer_generation", "chat"]
FailureKind = Literal["timeout", "provider", "internal"]


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
