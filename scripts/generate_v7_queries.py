from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "evaluation" / "v6" / "queries.json"
DESTINATION = ROOT / "evaluation" / "v7" / "queries.json"


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    destination = {
        "version": "v7",
        "k": source["k"],
        "rankingUnit": source["rankingUnit"],
        "fusionStrategy": "normalizedScore",
        "candidatePoolSize": source["candidatePoolSize"],
        "qualityMetric": source["qualityMetric"],
        "minimumQuality": source["minimumQuality"],
        "queries": source["queries"],
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with DESTINATION.open("w", encoding="utf-8") as output:
        json.dump(destination, output, ensure_ascii=False, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
