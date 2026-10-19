.PHONY: check setup api web web-check

check:
	npm run typecheck
	npm test

setup:
	npm ci
	npm --prefix web ci
	@if [ ! -e .env ]; then cp .env.example .env; fi

api:
	npm run api

web:
	npm run dev

web-check:
	npm --prefix web test
	npm --prefix web run build
