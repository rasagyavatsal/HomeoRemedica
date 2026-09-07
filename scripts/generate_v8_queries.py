from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    source = json.loads((ROOT / "evaluation/v7/queries.json").read_text(encoding="utf-8"))
    destination = {
        **source,
        "version": "v8",
        "remedyNameNormalization": "nfkcCasefoldWhitespace",
        "lexicalQueryMode": "contentTerms",
    }
    path = ROOT / "evaluation/v8/queries.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(destination, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
