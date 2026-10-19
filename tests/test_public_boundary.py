from __future__ import annotations

import ast
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MAX_TRACKED_FILE_BYTES = 8_000_000
FORBIDDEN_ROOTS = {
    "build",
    "artifacts",
    "corpora",
    "dataset",
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
        ):
            found.append(f"oversized tracked file: {path_text}")
    return tuple(found)


def pipeline_violations() -> tuple[str, ...]:
    """Keep the corpus tooling independent of the chat service and web API."""
    found: list[str] = []
    forbidden_imports = {
        ROOT / "src/corpus": {"production", "shared", "api"},
        ROOT / "src/shared": {"production", "corpus", "api"},
        ROOT / "src/production": {"api"},
    }
    for source_root, forbidden_roots in forbidden_imports.items():
        for path in source_root.glob("*.py"):
            for imported in _imports(path):
                imported_root = imported.partition(".")[0]
                if imported_root in forbidden_roots:
                    found.append(
                        f"invalid package dependency: {path.relative_to(ROOT)} imports {imported}"
                    )
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
