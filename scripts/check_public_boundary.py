from __future__ import annotations

import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MAX_TRACKED_FILE_BYTES = 1_000_000
FORBIDDEN_ROOTS = {
    "build",
    "corpora",
    "dataset",
    "dist",
    "evaluation",
    "output",
    "server-data",
}
FORBIDDEN_PATHS = {
    "corpus.toml",
    "src/homeoremedica_corpus",
}
FORBIDDEN_SUFFIXES = {
    ".db",
    ".sqlite",
    ".sqlite3",
    ".whl",
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
        if any(path_text == item or path_text.startswith(f"{item}/") for item in FORBIDDEN_PATHS):
            found.append(f"private path: {path_text}")
        if relative.suffix.lower() in FORBIDDEN_SUFFIXES:
            found.append(f"forbidden artifact: {path_text}")
        if path.is_symlink():
            found.append(f"tracked symlink: {path_text}")
        if path.is_file() and path.stat().st_size > MAX_TRACKED_FILE_BYTES:
            found.append(f"oversized tracked file: {path_text}")
    return tuple(found)


def main() -> int:
    found = violations()
    if not found:
        print("Public repository boundary is clean.")
        return 0
    print("Public repository boundary violations:")
    for violation in found:
        print(f"- {violation}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
