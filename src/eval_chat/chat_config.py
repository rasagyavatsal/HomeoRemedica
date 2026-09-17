"""Small configuration for chatting with an evaluation retrieval experiment."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class _FileSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    evaluation_config: str = "evaluation.toml"
    dimensions: int = Field(gt=0)
    model: str = Field(min_length=1)
    max_output_tokens: int = Field(gt=0, le=4_096)


@dataclass(frozen=True, slots=True)
class EvalChatConfig:
    evaluation_config: Path
    dimensions: int
    model: str
    max_output_tokens: int


def load_chat_config(path: Path = Path("eval-chat.toml")) -> EvalChatConfig:
    resolved = path.resolve()
    with resolved.open("rb") as source:
        settings = _FileSettings.model_validate(tomllib.load(source))
    evaluation_path = Path(settings.evaluation_config)
    if not evaluation_path.is_absolute():
        evaluation_path = resolved.parent / evaluation_path
    return EvalChatConfig(
        evaluation_config=evaluation_path.resolve(),
        dimensions=settings.dimensions,
        model=settings.model,
        max_output_tokens=settings.max_output_tokens,
    )
