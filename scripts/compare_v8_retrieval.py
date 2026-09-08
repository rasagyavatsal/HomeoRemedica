"""Replay the v7/v8 candidate caches without embedding or network calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from homeoremedica_corpus import evaluation as evaluation
from homeoremedica_corpus.chunking import corpus_hash
from homeoremedica_corpus.cli import _load_chunks
from homeoremedica_corpus.config import load_pipeline_config
from homeoremedica_corpus.paths import evaluation_path
from homeoremedica_corpus.retrieval import (
    DEFAULT_HYBRID_RETRIEVAL_POLICY,
    ScoredCandidate,
    lexical_content_terms,
    normalized_remedy_name,
)

ROOT = Path(__file__).resolve().parents[1]


def replay(dataset, chunks, config):
    chunk_ids = tuple(chunk.id for chunk in chunks)
    identities = {
        chunk.id: evaluation._ranking_id(
            chunk, dataset.ranking_unit, dataset.remedy_name_normalization
        )
        for chunk in chunks
    }
    groups = tuple(len(query.semantic_inputs) for query in dataset.queries)
    limit = min(len(chunks), max(dataset.k, dataset.candidate_pool_size))
    channels = []
    for role in ("semantic", "lexical"):
        input_groups = (
            dataset.semantic_input_groups
            if role == "semantic"
            else tuple(query.lexical_inputs for query in dataset.queries)
        )
        inputs = tuple(
            lexical_content_terms(text)
            if role == "lexical" and dataset.lexical_query_mode == "contentTerms"
            else text
            for group in input_groups
            for text in group
        )
        path = evaluation._ranking_cache_path(
            ROOT / ".cache/evaluation",
            role,
            corpus_hash(chunks),
            config.embedding.model,
            config.embedding.dimensions,
            limit,
            inputs,
            DEFAULT_HYBRID_RETRIEVAL_POLICY,
        )
        if path is None or not path.is_file():
            raise FileNotFoundError(f"run the {dataset.version} evaluation to populate {path}")
        raw = evaluation._load_scored_ranking_cache(path, chunk_ids, len(inputs))
        channels.append(evaluation._scored_rankings_for_unit(raw, identities))
    channels[0] = tuple(
        tuple(
            ScoredCandidate(
                c.chunk_id,
                c.score * dataset.semantic_score_weight ** (1 / evaluation.SCORE_FUSION_EXPONENT),
            )
            for c in ranking
        )
        for ranking in channels[0]
    )
    interleaved = tuple(ranking for pair in zip(*channels, strict=True) for ranking in pair)
    return evaluation._aggregate_scored_query_rankings(
        interleaved, tuple(size * 2 for size in groups), limit, evaluation.SCORE_FUSION_EXPONENT
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / ".cache/evaluation/v8-comparison.json"
    )
    args = parser.parse_args()
    output = evaluation_path(args.output, ROOT, allow_cache=True)
    config = load_pipeline_config(ROOT / "corpus.toml")
    _, chunks = _load_chunks(config)
    before, before_digest = evaluation.load_evaluation_dataset(ROOT / "evaluation/v7/queries.json")
    after, after_digest = evaluation.load_evaluation_dataset(ROOT / "evaluation/v8/queries.json")
    if before.queries != after.queries or before.k != after.k:
        raise ValueError("comparison requires identical queries, labels, and result depth")

    rankings_before = replay(before, chunks, config)
    rankings_after = replay(after, chunks, config)
    identity_only = before.model_copy(
        update={"remedy_name_normalization": after.remedy_name_normalization}
    )
    rankings_identity = replay(identity_only, chunks, config)
    variants = {
        "v7Literal": rankings_before,
        # Keep the original eight slots: normalize labels, without reranking or
        # backfilling duplicate identities. This isolates evaluation semantics.
        "v7NormalizedLabelsOnly": tuple(
            tuple(normalized_remedy_name(name) for name in ranking) for ranking in rankings_before
        ),
        "normalizedIdentityOnly": rankings_identity,
        "v8": rankings_after,
    }
    targets = {
        "literal": tuple({target.remedy_name for target in q.relevant} for q in before.queries),
        "normalized": tuple(
            {normalized_remedy_name(target.remedy_name) for target in q.relevant}
            for q in after.queries
        ),
    }
    development = {
        i
        for i, query in enumerate(before.queries)
        if query.id.endswith("-single")
        and int(hashlib.sha256(query.id.encode()).hexdigest(), 16) % 5 < 3
    }
    development_symptoms = {
        symptom for i in development for symptom in before.queries[i].semantic_inputs
    }
    validation = {
        i
        for i, query in enumerate(before.queries)
        if not development_symptoms.intersection(query.semantic_inputs)
    }
    recalls = {
        name: tuple(
            len(set(ranking[: after.k]) & relevant) / len(relevant)
            for ranking, relevant in zip(
                rankings,
                targets["literal" if name == "v7Literal" else "normalized"],
                strict=True,
            )
        )
        for name, rankings in variants.items()
    }
    summary = {
        name: {
            split: math.fsum(values[i] for i in indexes) / len(indexes)
            for split, indexes in (
                ("allRecallAt8", range(len(before.queries))),
                ("developmentRecallAt8", sorted(development)),
                ("validationRecallAt8", sorted(validation)),
            )
        }
        for name, values in recalls.items()
    }
    for version, dataset_digest in (("v7", before_digest), ("v8", after_digest)):
        recorded = json.loads((ROOT / f"evaluation/{version}/result.json").read_text())
        if (
            recorded["corpusHash"] != corpus_hash(chunks)
            or recorded["datasetSha256"] != dataset_digest
        ):
            raise ValueError(f"{version} results do not match the corpus and dataset")
        name = "v7Literal" if version == "v7" else "v8"
        if not math.isclose(summary[name]["allRecallAt8"], recorded["scores"][0]["recallAtK"]):
            raise ValueError(f"{version} replay does not reproduce the recorded recall")

    report = {
        "corpusHash": corpus_hash(chunks),
        "v7DatasetSha256": before_digest,
        "v8DatasetSha256": after_digest,
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
                "targets": sorted(targets["normalized"][i]),
                "v7Top8": list(rankings_before[i][: after.k]),
                "v8Top8": list(rankings_after[i][: after.k]),
                "recallAt8": {name: values[i] for name, values in recalls.items()},
            }
            for i, query in enumerate(after.queries)
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
