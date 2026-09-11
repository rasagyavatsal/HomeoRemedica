"""Path boundaries for experimental evaluation inputs and outputs."""

from pathlib import Path


def evaluation_path(path: Path, root: Path, *, allow_cache: bool = False) -> Path:
    """Resolve a JSON path inside the repository evaluation directories.

    Resolve the candidate before checking containment so symlinks and parent
    components cannot escape the trusted repository directories.
    """
    root = root.resolve()
    resolved = (root / path).resolve()
    directories = [root / "evaluation"]
    if allow_cache:
        directories.append(root / ".cache" / "evaluation")
    if not any(resolved.is_relative_to(directory) for directory in directories):
        raise ValueError("path must be inside a repository evaluation directory")
    if resolved.suffix != ".json":
        raise ValueError("evaluation paths must have a .json extension")
    return resolved


def evaluation_cache_directory(path: Path, root: Path) -> Path:
    """Resolve a directory inside the repository's experimental cache root."""
    root = root.resolve()
    resolved = (root / path).resolve()
    cache_root = root / ".cache" / "evaluation"
    if not resolved.is_relative_to(cache_root):
        raise ValueError("evaluation cache must be inside .cache/evaluation")
    return resolved
