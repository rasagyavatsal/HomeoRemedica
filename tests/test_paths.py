from pathlib import Path

import pytest

from homeoremedica_corpus.paths import evaluation_path


def test_evaluation_paths_accept_relative_and_absolute_json(tmp_path: Path) -> None:
    expected = tmp_path / "evaluation/v9/queries.json"
    assert evaluation_path(Path("evaluation/v9/queries.json"), tmp_path) == expected
    assert evaluation_path(expected, tmp_path) == expected
    cache = Path(".cache/evaluation/report.json")
    assert evaluation_path(cache, tmp_path, allow_cache=True) == tmp_path / cache


@pytest.mark.parametrize(
    "path",
    [
        "../outside.json",
        "evaluation/../../outside.json",
        "evaluation-other/report.json",
        ".cache/evaluation/report.json",
        "evaluation/report.py",
    ],
)
def test_evaluation_paths_reject_unauthorized_locations(tmp_path: Path, path: str) -> None:
    candidate = Path(path)
    with pytest.raises(ValueError):
        evaluation_path(candidate, tmp_path)
    assert not list(tmp_path.iterdir())


def test_evaluation_paths_reject_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    (root / "evaluation").symlink_to(tmp_path, target_is_directory=True)
    candidate = Path("evaluation/report.json")
    with pytest.raises(ValueError, match="inside"):
        evaluation_path(candidate, root)
