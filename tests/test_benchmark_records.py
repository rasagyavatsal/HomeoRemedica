from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUERIES = ROOT / "benchmarks" / "queries"
RESULTS = ROOT / "benchmarks" / "results"

QUERY_SHA256 = {
    "v1": "8fcdc38d6dcf0a78de9ad481b7c1a9804535940b5f308b053dedc19aa88a722b",
    "v2": "c799b531096d93bba8d4accd8da73fc3781d12f689d3a744d031ffe93e4147d9",
    "v3": "bbbbbeb678f40049155ce597c02defc9715d9e8d94302846ad1b86c8abce3ddb",
}
RESULT_QUERY_VERSION = {
    "v1": "v1",
    "v2": "v1",
    "v3": "v2",
    "v4": "v3",
    "v5": "v3",
    "v6": "v3",
    "v7": "v3",
    "v8": "v3",
    "v9": "v3",
}
HISTORICAL_DATASET_SHA256 = {
    "v1": "dedd5531e71557eb2b16819eb52fc562fbc872ea3bafae820defd74c2731a0f2",
    "v2": "7c0ef1e6f63e87131dd9ce4f9e302d1183fd3d3c008e8c48905707a5618f1c8e",
    "v3": "dbd701830da200a17e1f1d86f3b0ac910e4eedf109153bfc1403531a47d73adc",
    "v4": "b95affc7e433d38353f9c1e076df0934aac0123e00792d633d33417cc7cb713f",
    "v5": "7dcb6da8c710807afddf6d21b99ad3669091a6006519c77b0b16ee4b3bf36817",
    "v6": "0f965e04f465caf8b0a6107f655dc8286f90fff8b38feb0b67db61f805513918",
    "v7": "7ecc9f434f0e5afe6ec3f9fc42f38688918f167fb0a00e17ffa4325dc77018ae",
    "v8": "2e37273300b48887c640cf0b0407eab989a440c5b9eaa033e456822391713f25",
    "v9": "7f9ea67816134179084676df21c8e90cb55e2fc8e5f09c970ea3dc7fd3eaa5da",
}
QUALITY_VALUES = {
    "v1": (0.7196969696969697, 0.7424242424242423, 0.7424242424242423),
    "v2": (0.7878787878787878, 0.8333333333333333, 0.8636363636363636),
    "v3": (0.10833333333333332, 0.10166666666666667, 0.09233333333333332, 0.095),
    "v4": (0.076, 0.07533333333333334, 0.07566666666666667, 0.074),
    "v5": (0.08066666666666668,),
    "v6": (0.138,),
    "v7": (0.144,),
    "v8": (0.20766666666666667,),
    "v9": (0.24566666666666664,),
}


def test_query_datasets_are_deduplicated_and_contain_only_query_data() -> None:
    assert {path.name for path in QUERIES.glob("*.json")} == {
        "v1.json",
        "v2.json",
        "v3.json",
    }
    for version, expected_sha256 in QUERY_SHA256.items():
        contents = (QUERIES / f"{version}.json").read_bytes()
        data = json.loads(contents)
        assert set(data) == {"version", "queries"}
        assert data["version"] == version
        assert hashlib.sha256(contents).hexdigest() == expected_sha256


def test_all_results_link_to_queries_and_preserve_historical_hashes_and_scores() -> None:
    result_paths = sorted(
        path for path in RESULTS.glob("v*.json") if path.stem.removeprefix("v").isdigit()
    )
    assert [path.name for path in result_paths] == [f"v{version}.json" for version in range(1, 10)]

    for path in result_paths:
        result_version = path.stem
        data = json.loads(path.read_bytes())
        query_version = RESULT_QUERY_VERSION[result_version]
        assert data["queryVersion"] == query_version
        assert data["querySha256"] == QUERY_SHA256[query_version]
        assert data["historicalDatasetVersion"] == result_version
        assert data["historicalDatasetSha256"] == HISTORICAL_DATASET_SHA256[result_version]
        assert tuple(score["qualityValue"] for score in data["scores"]) == QUALITY_VALUES[
            result_version
        ]


def test_comparison_and_experiment_records_stay_beside_their_results() -> None:
    assert (RESULTS / "v8-comparison.json").is_file()
    assert (RESULTS / "v9-comparison.json").is_file()
    assert (RESULTS / "v9-experiments.json").is_file()

    v8 = json.loads((RESULTS / "v8-comparison.json").read_bytes())
    v9 = json.loads((RESULTS / "v9-comparison.json").read_bytes())
    experiments = json.loads((RESULTS / "v9-experiments.json").read_bytes())
    assert v8["summary"]["v8"]["allRecallAt8"] == QUALITY_VALUES["v8"][0]
    assert v9["summary"]["v9"]["allRecallAt8"] == QUALITY_VALUES["v9"][0]
    assert experiments["baseline"]["allRecall"] == QUALITY_VALUES["v8"][0]
    assert experiments["selected"]["allRecall"] == QUALITY_VALUES["v9"][0]
