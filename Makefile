UV ?= uv tool run --from uv==0.11.23 uv

.PHONY: check setup production experimental api web web-check

check:
	$(UV) run --locked python -m build
	$(UV) run --locked ruff check src api tests
	$(UV) run --locked pyright
	$(UV) run --locked pytest

setup:
	$(UV) sync --locked
	npm --prefix web ci
	@if [ ! -e .env ]; then cp .env.example .env; fi

production:
	$(UV) run --locked chat $(ARGS)

experimental:
	$(UV) run --locked eval-chat $(ARGS)

api:
	$(UV) run --locked uvicorn api.main:app --reload --host 127.0.0.1 --port 8000

web:
	$(UV) run --locked python -m api.dev

web-check:
	npm --prefix web test
	npm --prefix web run build
