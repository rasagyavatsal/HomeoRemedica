"""Replay v8/v9 candidate caches and check them against the recorded results."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from compare_v8_retrieval import replay

from corpus.chunking import corpus_hash
from eval.cli import _load_chunks
from eval.config import load_evaluation_config
from eval.evaluation import load_evaluation_dataset
from eval.paths import evaluation_path
from eval.retrieval import normalized_remedy_name

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / ".cache/evaluation/v9-comparison.json"
    )
    args = parser.parse_args()
    output = evaluation_path(args.output, ROOT, allow_cache=True)
    config = load_evaluation_config(ROOT / "evaluation.toml")
    _, chunks = _load_chunks(config)
    before, before_digest = load_evaluation_dataset(ROOT / "evaluation/v8/queries.json")
    after, after_digest = load_evaluation_dataset(ROOT / "evaluation/v9/queries.json")
    if before.queries != after.queries or before.k != after.k:
        raise ValueError("comparison requires identical queries, labels, and result depth")
    rankings = {"v8": replay(before, chunks, config), "v9": replay(after, chunks, config)}
    targets = tuple(
        {normalized_remedy_name(target.remedy_name) for target in query.relevant}
        for query in after.queries
    )
    development = {
        i
        for i, query in enumerate(after.queries)
        if query.id.endswith("-single")
        and int(hashlib.sha256(query.id.encode()).hexdigest(), 16) % 5 < 3
    }
    development_symptoms = {
        symptom for i in development for symptom in after.queries[i].semantic_inputs
    }
    validation = {
        i
        for i, query in enumerate(after.queries)
        if not development_symptoms.intersection(query.semantic_inputs)
    }
    recalls = {
        name: tuple(
            len(set(ranking[: after.k]) & relevant) / len(relevant)
            for ranking, relevant in zip(values, targets, strict=True)
        )
        for name, values in rankings.items()
    }
    summary = {
        name: {
            split: math.fsum(values[i] for i in indexes) / len(indexes)
            for split, indexes in (
                ("allRecallAt8", range(len(after.queries))),
                ("developmentRecallAt8", sorted(development)),
                ("validationRecallAt8", sorted(validation)),
            )
        }
        for name, values in recalls.items()
    }
    for version, digest in (("v8", before_digest), ("v9", after_digest)):
        result = json.loads((ROOT / f"evaluation/{version}/result.json").read_text())
        if result["corpusHash"] != corpus_hash(chunks) or result["datasetSha256"] != digest:
            raise ValueError(f"{version} result does not match the corpus and dataset")
        if not math.isclose(summary[version]["allRecallAt8"], result["scores"][0]["recallAtK"]):
            raise ValueError(f"{version} replay does not reproduce the recorded recall")
    report = {
        "corpusHash": corpus_hash(chunks),
        "v8DatasetSha256": before_digest,
        "v9DatasetSha256": after_digest,
        "semanticQueryInstruction": after.semantic_query_instruction,
        "k": after.k,
        "developmentQueries": len(development),
        "validationQueries": len(validation),
        "splitDescription": "Development: single-target IDs with SHA256(id) % 5 < 3. "
        "Validation: queries sharing no exact symptom text with development. "
        "Exploratory comparison, not an untouched external test set.",
        "summary": summary,
        "queries": [
            {
                "id": query.id,
                "split": "development"
                if i in development
                else "validation"
                if i in validation
                else "excluded",
                "targets": sorted(targets[i]),
                "v8Top8": list(rankings["v8"][i][: after.k]),
                "v9Top8": list(rankings["v9"][i][: after.k]),
                "recallAt8": {name: values[i] for name, values in recalls.items()},
            }
            for i, query in enumerate(after.queries)
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
