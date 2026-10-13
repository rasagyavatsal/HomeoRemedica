"""Keep conversation context identical across terminal and web sessions."""

from __future__ import annotations

from shared.contracts import MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, ChatTurn


def advance_history(
    history: tuple[ChatTurn, ...], message: str, answer: str
) -> tuple[ChatTurn, ...]:
    recent = (
        *history,
        ChatTurn(role="user", content=message),
        ChatTurn(role="assistant", content=answer[:4_000]),
    )[-MAX_HISTORY_TURNS:]
    while sum(len(turn.content) for turn in recent) > MAX_HISTORY_CHARS:
        recent = recent[1:]
    return recent
