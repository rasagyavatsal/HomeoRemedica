# HomeoRemedica

A reference chat assistant for historical homoeopathic materia medica by Allen, Boericke,
Clarke, and Kent. It retrieves passages from a local corpus and generates answers with source
citations. Historical reference only; not medical advice.

The chat CLI runs directly in Python without a server. Retrieval combines
SQLite FTS5 and `sqlite-vec` vector search using reciprocal-rank fusion. OpenRouter provides
`qwen/qwen3-embedding-8b` embeddings; Z.AI generates answers with `glm-5.3-flash` by default.

## Quick start

Requirements: Python 3.14 (pinned to 3.14.3), uv `>=0.11.23,<0.12`,
and API keys for OpenRouter and Z.AI. Corpus builds require SQLite 3.53.4 and
`sqlite-vec` 0.1.9, as configured in `corpus.toml`.

Run from the repository root:

```sh
uv sync --locked
cp .env.example .env
```

Set `OPENROUTER_API_KEY` and `ZAI_API_KEY` in `.env`, then build the corpus and start chatting:

```sh
uv run --locked homeoremedica-corpus validate
uv run --locked homeoremedica-corpus build local-v1
uv run --locked homeoremedica-chat
```

The CLI verifies the active corpus at startup. Type a question, use `/books` to list the
available books, `/clear` to reset conversation history, or `/quit` to exit. It prints the
answer and numbered source references. To ask one question and exit, run:

```sh
uv run --locked homeoremedica-chat What does Kent say about Nux vomica?
uv run --locked homeoremedica-chat --book kent-lectures "What does Kent say about Nux vomica?"
uv run --locked homeoremedica-chat --list-books
```

Repeat `--book` to search up to four selected books. Conversation history stays in memory for
the current CLI session.

The source dataset is included; generated SQLite releases are not. Building a release calls
OpenRouter to embed the corpus. Use a unique version for each build; existing releases cannot
be overwritten. To use an existing release instead, set `RAG_CORPUS_DIR` to its parent directory
containing `active.json`.

## Configuration

The CLI reads environment variables and optional `.env` and `.env.local` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Required | Corpus and query embeddings. |
| `ZAI_API_KEY` | Required for chat | Answer generation. |
| `RAG_CORPUS_DIR` | `artifacts/corpus` | Active pointer and versioned corpus releases. |
| `RAG_MODEL` | `glm-5.3-flash` | Answer model. |
| `RAG_MAX_OUTPUT_TOKENS` | `4096` | Output token limit, from 1 to 4096. |

Each question retrieves up to eight passages from the local corpus and sends the grounded prompt
to Z.AI. OpenRouter supplies query embeddings. No local HTTP server is needed.

## Corpus tooling

`corpus.toml` configures the source data, chunking, embeddings, and release output. The default
pipeline reads `dataset/corpus.json`, treats each passage as one chunk, and builds one shared
SQLite database for all four books.

```sh
# Validate sources and chunking locally; no API key needed.
uv run --locked homeoremedica-corpus validate

# Verify and activate an existing release.
uv run --locked homeoremedica-corpus activate local-v1
```

Builds write `corpus.sqlite` and `manifest.json` under `artifacts/corpus/<version>/`, then update
`active.json` after verification. Start a new CLI session to load a newly activated release.
Use `build <version> --workers 8` to reduce the default 32 concurrent embedding requests.

## Evaluation

`src/eval/` runs retrieval experiments independently of chat and corpus releases. Settings live
in `evaluation.toml`; query datasets and recorded results live in `benchmarks/`.

Before running, change `output.result` in `evaluation.toml` to an unused versioned path such as
`benchmarks/results/v10.json`. The checked-in configuration points to the existing v9 result,
and results cannot be overwritten.

```sh
uv run --locked homeoremedica-evaluation
```

Evaluation requires an OpenRouter key and caches embeddings and rankings in `.cache/benchmarks/`.
See the [benchmark records](benchmarks/README.md) for details.

## Development

```sh
uv sync --locked --all-groups
make check
```

`make check` runs repository boundary checks, a Python build, Ruff, Pyright, and
pytest. Tests use fakes and synthetic artifacts; they do not require API keys or a built corpus.

- `src/chat/` — chat orchestration, provider integration, and local retrieval.
- `src/chat/cli.py` — local terminal chat.
- `src/corpus/` — source validation, chunking, embeddings, and release tooling.
- `src/eval/` — experimental retrieval and scoring.
- `dataset/` — raw texts, processed books, and merged corpus; see the [dataset guide](dataset/README.md).
- `tests/` — Python test suite.

## License

Software and documentation: [MIT](LICENSE). Dataset compilation and processing:
[CC BY 4.0](dataset/LICENSE.md). Underlying historical works retain their applicable rights
and source notices.
