from __future__ import annotations

import ast
import subprocess
import tomllib
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MAX_TRACKED_FILE_BYTES = 8_000_000
LARGE_SOURCE_FILES = {PurePosixPath("dataset/combined.json")}
FORBIDDEN_ROOTS = {
    "build",
    "corpora",
    "dist",
    "output",
    "server-data",
}
FORBIDDEN_SUFFIXES = {
    ".db",
    ".gz",
    ".sqlite",
    ".sqlite3",
    ".tar",
    ".tgz",
    ".whl",
    ".zip",
    ".zst",
}


def tracked_files() -> tuple[PurePosixPath, ...]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return tuple(
        PurePosixPath(item.decode()) for item in result.stdout.split(b"\0") if item
    )


def violations() -> tuple[str, ...]:
    found: list[str] = []
    for relative in tracked_files():
        path_text = relative.as_posix()
        path = ROOT / path_text
        if relative.parts[0] in FORBIDDEN_ROOTS:
            found.append(f"forbidden root: {path_text}")
        if relative.suffix.lower() in FORBIDDEN_SUFFIXES:
            found.append(f"forbidden artifact: {path_text}")
        if path.is_symlink():
            found.append(f"tracked symlink: {path_text}")
        if (
            path.is_file()
            and path.stat().st_size > MAX_TRACKED_FILE_BYTES
            and relative not in LARGE_SOURCE_FILES
        ):
            found.append(f"oversized tracked file: {path_text}")
    return tuple(found)


def pipeline_violations() -> tuple[str, ...]:
    """Keep experimental code and settings out of the chat release graph."""
    found: list[str] = []
    forbidden_imports = {
        ROOT / "src/corpus": {"chat", "eval"},
        ROOT / "src/chat": {"eval"},
        ROOT / "src/eval": {"chat"},
    }
    for source_root, forbidden_roots in forbidden_imports.items():
        for path in source_root.glob("*.py"):
            for imported in _imports(path):
                imported_root = imported.partition(".")[0]
                if imported_root in forbidden_roots:
                    found.append(
                        f"invalid package dependency: {path.relative_to(ROOT)} imports {imported}"
                    )

    with (ROOT / "corpus.toml").open("rb") as source:
        corpus_settings = tomllib.load(source)
    with (ROOT / "evaluation.toml").open("rb") as source:
        evaluation_settings = tomllib.load(source)
    if "evaluation" in corpus_settings:
        found.append("corpus.toml contains evaluation settings")
    release_output = (ROOT / corpus_settings["corpus"]["output_directory"]).resolve()
    evaluation_outputs = tuple(
        (ROOT / evaluation_settings["output"][key]).resolve()
        for key in ("result", "cache_directory")
    )
    if any(
        path.is_relative_to(release_output) or release_output.is_relative_to(path)
        for path in evaluation_outputs
    ):
        found.append("evaluation and release outputs overlap")
    return tuple(found)


def _imports(path: Path) -> tuple[str, ...]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.append(node.module)
        elif isinstance(node, ast.Import):
            imported.extend(alias.name for alias in node.names)
    return tuple(imported)


def test_public_boundary() -> None:
    found = (*violations(), *pipeline_violations())
    assert not found, "\n".join(found)
