# HomeoRemedica

A Python retrieval-augmented generation (RAG) application for searching historical homoeopathic
literature and generating answers with source citations. It makes **118,259 passages** from
**four books**, covering **1,250 unique remedies**, searchable through a conversational web app.
The source works are by Allen, Boericke, Clarke, and Kent. Historical reference only; not medical
advice.

The project covers corpus preparation, hybrid search, and answer generation. Search runs
against a local SQLite database; external APIs provide embeddings and generated answers. A
React frontend talks to the production pipeline through a FastAPI server.

**Stack:** Python · FastAPI · Uvicorn · React · Vite · TypeScript · SQLite FTS5 · sqlite-vec ·
Pydantic · OpenRouter · Z.AI · pytest · Ruff · Pyright

## Engineering highlights

- **Hybrid retrieval:** combines keyword and vector search through reciprocal-rank fusion, with
  optional filtering by book and up to eight retrieved passages per answer.
- **Structured corpus:** preserves book, remedy, section, and passage metadata across 118,259
  individually embedded passages.
- **Verified corpus releases:** builds immutable SQLite artifacts with manifests and SHA-256
  digests, validates database and index integrity, and verifies releases before activation.
- **Automated quality checks:** checks package boundaries, builds the Python package, runs linting
  and type checking, tests against fakes and synthetic artifacts without API keys, and tests and
  builds the frontend.

## Architecture

The `production` pipeline builds and searches a versioned local corpus:

```mermaid
flowchart TD
    A[Historical source texts] --> B[Structured corpus with source metadata]
    B --> C[Passage chunks]
    C --> D[Document embeddings via OpenRouter]
    C --> E[Verified SQLite release: FTS5 and vector indexes]
    D --> E
    Q[Web question and recent conversation] --> K[Keyword search]
    Q --> V[Query embedding via OpenRouter]
    V --> S[Vector search]
    E --> K
    E --> S
    K --> R[Reciprocal-rank fusion]
    S --> R
    R --> P[Up to eight passages with source metadata]
    Q --> G[Answer generation via Z.AI]
    P --> G
    G --> O[Answer with numbered source references]
```

OpenRouter provides `qwen/qwen3-embedding-8b` embeddings; Z.AI generates answers with
`glm-5.3-flash` by default.

| Design choice | Engineering benefit |
| --- | --- |
| SQLite with FTS5 and sqlite-vec | Keeps source metadata, keyword search, and vector search in one local database. |
| One passage per chunk | Retains the source passage as the retrieval and citation unit. |
| Reciprocal-rank fusion | Combines keyword and semantic rankings without requiring their raw scores to share a scale. |
| Immutable, verified corpus releases | Records the corpus and embedding configuration used by each release and checks integrity before use. |

## Quick start

Requirements: Python 3.14 (pinned to 3.14.3), uv, make, Node.js 22.12+
on a supported even release (Node.js 24 recommended), npm, and API keys for
OpenRouter and Z.AI. Corpus builds require SQLite 3.53.4 and `sqlite-vec` 0.1.9,
as configured in `corpus.toml`.

Run from the repository root:

```sh
make setup
```

This installs the locked Python and frontend dependencies and creates `.env` from `.env.example`
if it does not already exist. Makefile commands use the pinned uv 0.11.23 automatically for
Python. Direct `uv` commands below require uv `>=0.11.23,<0.12`; if your
installed version is outside that range, replace `uv` with
`uv tool run --from uv==0.11.23 uv`.

Set `OPENROUTER_API_KEY` and `ZAI_API_KEY` in `.env`. The web app needs an active corpus
release. If you do not already have one, build it:

```sh
uv run --locked corpus validate
uv run --locked corpus build local-v1
```

The source dataset is proprietary and not included; place it in `dataset/` to build releases.
Generated SQLite releases are not included either. Building a release calls
OpenRouter to embed the corpus. Use a unique version for each build; existing releases cannot
be overwritten. To use an existing release instead, set `RAG_CORPUS_DIR` to its parent directory
containing `active.json`.

## Web app

Run the web app from a source checkout. API keys stay on the Python server.

After setup and corpus preparation above, start the complete web app in one terminal:

```sh
make web
```

Open `http://127.0.0.1:5173`. The command starts Vite and FastAPI together with automatic reload.
Vite forwards `/api` requests to FastAPI on port 8000. Ctrl+C stops both servers; if either
server exits, the other is stopped too. Port 5173 must be available; Vite will report an error
instead of switching to another port. Restart after activating a new corpus release or changing
`.env`.
Select books to limit retrieval, send questions, inspect numbered sources, and clear the
conversation. Enter sends; Shift+Enter adds a line. `/books`, `/clear`, `/quit`, and `/exit` also
work in the message box. Conversation history lives in the current browser session's memory
and resets on refresh.

To serve a built frontend and the API from one server:

```sh
npm --prefix web run build
uv run --locked uvicorn api.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. `make api` remains available for running only the API with automatic
reload. `npm --prefix web run preview` also proxies API requests to port 8000.

The API initializes the verified corpus and provider clients lazily, so setup errors appear in
the app. `GET /api/health` checks the server; `GET /api/books` lists the production books without
requiring provider keys; `POST /api/chat` accepts `message`, `history`, and optional `bookIds`.
Responses include the answer, source citations, corpus/model metadata, and the trimmed history
to send with the next question. Interactive API documentation is at `/docs`.

## Configuration

The API reads environment variables and optional `.env` and `.env.local` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Required | Corpus and query embeddings. |
| `ZAI_API_KEY` | Required for chat | Answer generation. |
| `RAG_CORPUS_DIR` | `artifacts/corpus` | Active pointer and versioned corpus releases. |
| `RAG_MODEL` | `glm-5.3-flash` | Answer model. |
| `RAG_MAX_OUTPUT_TOKENS` | `4096` | Output token limit, from 1 to 4096. |

Each question retrieves up to eight passages from the local corpus and sends the grounded prompt
to Z.AI. OpenRouter supplies query embeddings.

## Corpus tooling

`corpus.toml` configures the source data, chunking, embeddings, and release output. The default
pipeline reads `dataset/corpus.json`, treats each passage as one chunk, and builds one shared
SQLite database for all four books.

```sh
# Validate sources and chunking locally; no API key needed.
uv run --locked corpus validate

# Verify and activate an existing release.
uv run --locked corpus activate local-v1
```

Builds write `corpus.sqlite` and `manifest.json` under `artifacts/corpus/<version>/`, then update
`active.json` after verification. Restart the API to load a newly activated release.
Use `build <version> --workers 8` to reduce the default 32 concurrent embedding requests.

## Development

```sh
make setup
make check
make web-check
```

`make check` validates Python: package building, Ruff linting, Pyright type checking, and pytest.
The test suite includes repository boundary checks, which reject generated artifacts in Git
and keep the corpus tooling independent of the chat service and API.
Tests use fakes and synthetic artifacts; they do not require API keys or a built corpus.
`make web-check` validates the frontend: interaction tests followed by a Vite build, which also
runs TypeScript type checking. `make web` starts Vite and FastAPI together with automatic reload;
`make api` starts only FastAPI.

- `src/shared/` — conversation contracts, chat service, answer generation, and prompts.
- `src/production/` — production retrieval from an active corpus release.
- `src/api/` — FastAPI interface to the production service and optional built frontend hosting.
- `web/` — minimal React/Vite chat interface.
- `src/corpus/` — source validation, chunking, embeddings, and release tooling.
- `dataset/` — local checkout of the private source dataset; ignored by Git.
- `tests/` — Python test suite.

## License

Software and documentation: [MIT](LICENSE). The dataset is proprietary and not distributed with
this repository. Underlying historical works retain their applicable rights and source notices.
