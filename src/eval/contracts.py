from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _camel_case(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class Contract(BaseModel):
    model_config = ConfigDict(
        alias_generator=_camel_case,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class EvaluationGate(Contract):
    """Summary of a passing experimental result; never consumed by chat releases."""

    query_version: str
    query_sha256: str
    corpus_hash: str
    result_sha256: str
    metric: str
    threshold: float = Field(ge=0)
    value: float = Field(ge=0)
    chosen_dimensions: int = Field(gt=0, le=4096)

    @model_validator(mode="after")
    def validate_gate(self) -> EvaluationGate:
        _validate_digest(self.query_sha256, "evaluation query_sha256")
        _validate_digest(self.corpus_hash, "evaluation corpus_hash")
        _validate_digest(self.result_sha256, "evaluation result_sha256")
        if self.value < self.threshold:
            raise ValueError("evaluation quality result does not meet its threshold")
        return self


def canonical_json_bytes(model: BaseModel | dict[str, Any]) -> bytes:
    value = model.model_dump(mode="json", by_alias=True) if isinstance(model, BaseModel) else model
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("utf-8")


def _validate_digest(value: str, name: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(f"{name} must be a lowercase SHA-256 digest")
