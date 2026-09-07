from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTRUCTION = (
    "Given a symptom description, retrieve relevant materia medica passages describing "
    "matching symptoms, modalities, and locations."
)


def main() -> None:
    source = json.loads((ROOT / "evaluation/v8/queries.json").read_text(encoding="utf-8"))
    destination = {
        **source,
        "version": "v9",
        "semanticQueryInstruction": INSTRUCTION,
    }
    path = ROOT / "evaluation/v9/queries.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(destination, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
