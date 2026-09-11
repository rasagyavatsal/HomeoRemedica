.PHONY: boundary build frontend lint typecheck test check

boundary:
	uv run --locked pytest tests/test_public_boundary.py

build:
	uv run --locked python -m build

frontend:
	npm --prefix frontend ci
	npm --prefix frontend run build

lint:
	uv run --locked ruff check src tests

typecheck:
	uv run --locked pyright

test:
	uv run --locked pytest

check: boundary build frontend lint typecheck test
