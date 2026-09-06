from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "evaluation" / "v5" / "queries.json"
DESTINATION = ROOT / "evaluation" / "v6" / "queries.json"


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    destination = {
        "version": "v6",
        "k": source["k"],
        "rankingUnit": "globalRemedy",
        "candidatePoolSize": source["candidatePoolSize"],
        "qualityMetric": source["qualityMetric"],
        "minimumQuality": source["minimumQuality"],
        "queries": source["queries"],
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(
        json.dumps(destination, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
