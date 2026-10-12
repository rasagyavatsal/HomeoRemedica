.PHONY: boundary build lint typecheck test check api web web-check

boundary:
	uv run --locked pytest tests/test_public_boundary.py

build:
	uv run --locked python -m build

lint:
	uv run --locked ruff check src api tests

typecheck:
	uv run --locked pyright

test:
	uv run --locked pytest

check: boundary build lint typecheck test

api:
	uv run --locked uvicorn api.main:app --reload --host 127.0.0.1 --port 8000

web:
	npm --prefix web run dev

web-check:
	npm --prefix web run typecheck
	npm --prefix web test
	npm --prefix web run build
