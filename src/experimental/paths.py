"""Path boundaries for experimental benchmark inputs and outputs."""

from pathlib import Path


def benchmark_path(path: Path, root: Path, *, allow_cache: bool = False) -> Path:
    """Resolve a JSON path inside the repository benchmark directories.

    Resolve the candidate before checking containment so symlinks and parent
    components cannot escape the trusted repository directories.
    """
    root = root.resolve()
    resolved = (root / path).resolve()
    directories = [root / "benchmarks"]
    if allow_cache:
        directories.append(root / ".cache" / "benchmarks")
    if not any(resolved.is_relative_to(directory) for directory in directories):
        raise ValueError("path must be inside a repository benchmark directory")
    if resolved.suffix != ".json":
        raise ValueError("benchmark paths must have a .json extension")
    return resolved


def benchmark_query_path(path: Path, root: Path) -> Path:
    """Resolve a JSON path inside the versioned benchmark query directory."""
    resolved = benchmark_path(path, root)
    if not resolved.is_relative_to(root.resolve() / "benchmarks" / "queries"):
        raise ValueError("query datasets must be inside benchmarks/queries")
    return resolved


def benchmark_result_path(path: Path, root: Path) -> Path:
    """Resolve a JSON path inside the immutable benchmark result directory."""
    resolved = benchmark_path(path, root)
    if not resolved.is_relative_to(root.resolve() / "benchmarks" / "results"):
        raise ValueError("evaluation results must be inside benchmarks/results")
    return resolved


def benchmark_cache_directory(path: Path, root: Path) -> Path:
    """Resolve a directory inside the repository's benchmark cache root."""
    root = root.resolve()
    resolved = (root / path).resolve()
    cache_root = root / ".cache" / "benchmarks"
    if not resolved.is_relative_to(cache_root):
        raise ValueError("benchmark cache must be inside .cache/benchmarks")
    return resolved


# Compatibility aliases for callers that use the evaluation package vocabulary.
evaluation_path = benchmark_path
evaluation_cache_directory = benchmark_cache_directory
