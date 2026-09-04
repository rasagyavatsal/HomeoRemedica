.PHONY: boundary build lint typecheck test check

boundary:
	python scripts/check_public_boundary.py

build:
	uv run --locked python -m build

lint:
	uv run --locked ruff check src tests

typecheck:
	uv run --locked pyright

test:
	uv run --locked pytest

check: boundary build lint typecheck test
