from pathlib import Path

import pytest

from eval.paths import (
    benchmark_cache_directory,
    benchmark_path,
    benchmark_query_path,
    benchmark_result_path,
)


def test_benchmark_paths_accept_relative_and_absolute_json(tmp_path: Path) -> None:
    expected = tmp_path / "benchmarks/queries/v3.json"
    assert benchmark_path(Path("benchmarks/queries/v3.json"), tmp_path) == expected
    assert benchmark_path(expected, tmp_path) == expected
    cache = Path(".cache/benchmarks/report.json")
    assert benchmark_path(cache, tmp_path, allow_cache=True) == tmp_path / cache


def test_query_and_result_paths_stay_in_their_collections(tmp_path: Path) -> None:
    query = Path("benchmarks/queries/v3.json")
    result = Path("benchmarks/results/v9.json")
    assert benchmark_query_path(query, tmp_path) == tmp_path / query
    assert benchmark_result_path(result, tmp_path) == tmp_path / result
    with pytest.raises(ValueError, match="benchmarks/queries"):
        benchmark_query_path(result, tmp_path)
    with pytest.raises(ValueError, match="benchmarks/results"):
        benchmark_result_path(query, tmp_path)


@pytest.mark.parametrize(
    "path",
    [
        "../outside.json",
        "benchmarks/../../outside.json",
        "benchmarks-other/report.json",
        ".cache/benchmarks/report.json",
        "benchmarks/report.py",
    ],
)
def test_benchmark_paths_reject_unauthorized_locations(tmp_path: Path, path: str) -> None:
    candidate = Path(path)
    with pytest.raises(ValueError):
        benchmark_path(candidate, tmp_path)
    assert not list(tmp_path.iterdir())


def test_benchmark_paths_reject_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    (root / "benchmarks").symlink_to(tmp_path, target_is_directory=True)
    candidate = Path("benchmarks/report.json")
    with pytest.raises(ValueError, match="inside"):
        benchmark_path(candidate, root)


def test_benchmark_cache_directory_stays_in_its_experimental_root(tmp_path: Path) -> None:
    assert benchmark_cache_directory(Path(".cache/benchmarks/v9"), tmp_path) == (
        tmp_path / ".cache/benchmarks/v9"
    )
    with pytest.raises(ValueError, match="inside"):
        benchmark_cache_directory(Path("artifacts/corpus"), tmp_path)
