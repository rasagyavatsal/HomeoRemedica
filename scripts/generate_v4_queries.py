from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "evaluation" / "v3" / "queries.json"
DESTINATION = ROOT / "evaluation" / "v4" / "queries.json"
QUERY_CONTEXT_SUFFIXES = (
    "Taking the locations, sensations, modalities, concomitants, and mental or physical "
    "generals together, List remedies.",
    "Taking the evolving locations, sensations, modalities, concomitants, and generals into "
    "account, List remedies.",
)


def convert_query(query: dict[str, object]) -> dict[str, object]:
    text = str(query["query"])
    matching = [suffix for suffix in QUERY_CONTEXT_SUFFIXES if text.endswith(suffix)]
    if len(matching) != 1:
        raise ValueError(f"query {query['id']!r} does not have one recognized context suffix")
    symptoms_text = text[: -len(matching[0])].strip()
    symptoms = [symptom.strip() for symptom in symptoms_text.split("; ")]
    if not symptoms or any(not symptom for symptom in symptoms):
        raise ValueError(f"query {query['id']!r} has an empty symptom")
    return {
        "id": query["id"],
        "symptoms": symptoms,
        "relevant": query["relevant"],
    }


def main() -> None:
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    destination = {
        "version": "v4",
        "k": source["k"],
        "qualityMetric": source["qualityMetric"],
        "minimumQuality": source["minimumQuality"],
        "queries": [convert_query(query) for query in source["queries"]],
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with DESTINATION.open("w", encoding="utf-8") as output:
        json.dump(destination, output, ensure_ascii=False, indent=2)
        output.write("\n")


if __name__ == "__main__":
    main()
