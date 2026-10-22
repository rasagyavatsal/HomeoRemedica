# HomeoRemedica

A TypeScript retrieval-augmented generation (RAG) application for searching historical homoeopathic
literature and generating answers with source citations. It makes **5,846 chunks** from
**four books**, covering **996 unique remedies**, searchable through a conversational web app.
The source works are by Allen, Boericke, Clarke, and Kent. Historical reference only; not medical
advice.

**Live app:** <https://homeoremedica-619837289655.asia-south1.run.app>

The project covers hybrid search and answer generation. Search runs against a Qdrant collection
built by the private [HomeoRemedica-dataset](https://github.com/rasagyavatsal/HomeoRemedica-dataset) repository; external APIs provide query embeddings and
generated answers. A React frontend talks to the production pipeline through a Hono API server on Node.js.

**Stack:** TypeScript · Node.js · Hono · Zod · React · Vite · Qdrant · OpenRouter · Z.AI ·
Vitest

## Engineering highlights

- **Hybrid retrieval:** fuses BM25 and voyage-4 vector rankings inside Qdrant through
  reciprocal-rank fusion, with up to eight retrieved chunks per answer.
- **Structured corpus:** preserves book, remedy, and section metadata on every chunk, so
  citations point to their source.
- **Automated quality checks:** checks package boundaries, type-checks the server, tests against
  fakes without API keys, and tests and builds the frontend.

## Architecture

The [HomeoRemedica-dataset](https://github.com/rasagyavatsal/HomeoRemedica-dataset) repository chunks the source texts and indexes them in Qdrant. The `production`
pipeline searches that collection and generates the answer:

```mermaid
flowchart TD
    A[Historical source texts] --> C[Chunks with source metadata]
    C --> E[Qdrant collection: voyage-4 dense and BM25 sparse vectors]
    Q[Web question and recent conversation] --> K[BM25 query encoding inside Qdrant]
    Q --> V[voyage-4 query embedding via OpenRouter]
    K --> R[Reciprocal-rank fusion in Qdrant]
    V --> R
    E --> R
    R --> P[Up to eight chunks with source metadata]
    Q --> G[Answer generation via Z.AI]
    P --> G
    G --> O[Answer with numbered source references]
```

OpenRouter provides `voyageai/voyage-4` query embeddings (1024 dimensions); Z.AI generates
answers with `glm-5.3-flash` by default.

| Design choice | Engineering benefit |
| --- | --- |
| Qdrant with named dense and sparse vectors | Keeps source metadata, keyword search, and vector search in one collection. |
| Reciprocal-rank fusion | Combines keyword and semantic rankings without requiring their raw scores to share a scale. |
| Same BM25 model at index and query time | Qdrant's server-side `qdrant/bm25` inference tokenizes queries exactly as the dataset indexed them, so the server needs no local model. |

## Quick start

Requirements: Node.js 22.18+ on a supported even release (Node.js 24 recommended), npm, a Qdrant
1.15.2+ cluster holding the `materia_medica` collection, and API keys for OpenRouter and Z.AI.
Node.js runs the TypeScript server directly, so the server has no build step.

Run from the repository root:

```sh
npm ci
cp .env.example .env
```

Set `QDRANT_URL`, `QDRANT_API_KEY`, `OPENROUTER_API_KEY`, and `ZAI_API_KEY` in `.env`. The
collection is built and updated by `scripts/embed_chunks.py` in the [HomeoRemedica-dataset](https://github.com/rasagyavatsal/HomeoRemedica-dataset)
repository.

## Web app

Run the web app from a source checkout. API keys stay on the server.

After setup above, start the web app:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite dev server serves the frontend and the API from one
process; edits to either reload automatically. Port 5173 must be available; Vite will report an
error instead of switching to another port. Restart after changing `.env`.
Send questions, inspect numbered sources, and clear the conversation. Enter sends; Shift+Enter
adds a line. `/clear`, `/quit`, and `/exit` also work in the message box. Conversation history lives in the current browser session's memory
and resets on refresh.

To serve a built frontend and the API from one Node.js server:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:8000`.

The API initializes the Qdrant and provider clients lazily and checks that the collection exists,
so setup errors appear in the app. `GET /api/health` checks the server; `GET /api/books` lists the
production books without requiring provider keys; `POST /api/chat` accepts `message` and
`history`. Responses include the answer, source citations, corpus/model metadata,
and the trimmed history to send with the next question.

## Configuration

The API reads environment variables and optional `.env` and `.env.local` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QDRANT_URL` | Required for chat | Qdrant cluster URL. |
| `QDRANT_API_KEY` | None | Qdrant API key, required by Qdrant Cloud. |
| `RAG_QDRANT_COLLECTION` | `materia_medica` | Collection to search. |
| `OPENROUTER_API_KEY` | Required for chat | Query embeddings. |
| `ZAI_API_KEY` | Required for chat | Answer generation. |
| `RAG_MODEL` | `glm-5.3-flash` | Answer model. |
| `RAG_MAX_OUTPUT_TOKENS` | `4096` | Output token limit, from 1 to 4096. |
| `HOST` | `127.0.0.1` | Address `npm start` listens on. |
| `PORT` | `8000` | Port `npm start` listens on. |

Each question retrieves up to eight chunks from Qdrant and sends the grounded prompt to Z.AI.
OpenRouter supplies query embeddings.

## Development

```sh
npm run check
```

`npm run check` type-checks the server and the frontend, runs the Vitest suite, and builds the
frontend. Tests use fakes; they do not require API keys or a Qdrant cluster. The suite includes
repository boundary checks, which reject generated artifacts in Git, keep the web framework in
the HTTP layer, and allow the frontend to import only types from the server, so server code
never reaches the browser bundle.

- `src/server/` — request contracts, the chat service, Qdrant retrieval, provider clients, and
  the Hono API, which also serves the built frontend.
- `src/web/` — minimal React chat interface; it shares the server's contract types.
- `tests/` — server test suite. Frontend tests sit next to the components in `src/web/`.

## Deployment

The app runs on Cloud Run at <https://homeoremedica-619837289655.asia-south1.run.app>. Every push
to `main` runs `npm run check` and deploys through the `Deploy` GitHub Actions workflow, which
authenticates to Google Cloud with Workload Identity Federation. To deploy manually:

```sh
npm run deploy
```

`npm run deploy` builds the `Dockerfile` with Cloud Build and deploys it to the `homeoremedica`
Cloud Run service in `asia-south1`, capped at three instances so the per-instance chat rate limits
also bound total provider spend. The service keeps its configuration between deploys:
`QDRANT_URL` is a plain environment variable, and `OPENROUTER_API_KEY`, `ZAI_API_KEY`, and
`QDRANT_API_KEY` come from Secret Manager. Local `.env` files are not copied into the image.

## License

Software and documentation: [MIT](LICENSE). The dataset is proprietary, lives in the private
[HomeoRemedica-dataset](https://github.com/rasagyavatsal/HomeoRemedica-dataset) repository, and is not distributed with this repository. Underlying historical works retain their applicable rights and source notices.
