# HomeoRemedica

HomeoRemedica is an open-source Python project containing a web client and the complete source
pipeline for a grounded reference assistant covering four classical homoeopathic materia medica
books: Clarke, Boericke, Kent, and Allen. Answers are generated from retrieved corpus excerpts and
include stable source IDs. The output is a study reference, not medical advice.

The software is available under the MIT License. The raw and processed corpus under `dataset/` is
included in the repository and its original compilation and processing are available under the
Creative Commons Attribution 4.0 International License (CC BY 4.0).

## Repository layout

- `src/chat/` — chat engine, runtime configuration, and verified local-corpus client.
- `src/web/` — FastAPI endpoints and production static-file serving.
- `frontend/` — React, TypeScript, and Vite browser client.
- `src/corpus/` — source validation, chunking, and local SQLite release building.
- `src/eval/` — isolated experimental retrieval, embedding, configuration,
  contracts, and result tooling.
- `dataset/raw-text/` — source text for the four books.
- `dataset/processed/` — validated per-book sectioned JSON sources.
- `dataset/corpus.json` — the remedy-merged corpus file consumed by the pipeline.
- [`benchmarks/queries/`](benchmarks/README.md) — three independently versioned retrieval-query
  datasets.
- `benchmarks/results/` — nine immutable results with their comparison and experiment records.
- `corpus.toml` — chat release configuration.
- `evaluation.toml` — experimental evaluation inputs, embeddings, and output locations.

The `chat`, `corpus`, `eval`, and `web` Python packages are built and tested together from the
repository root. The project remains branded `HomeoRemedica`.

## Reproducible environment

Python 3.14.3, dependencies, SQLite 3.53.4, and pre-1.0 `sqlite-vec` 0.1.9 are pinned by
`.python-version`, `uv.lock`, `corpus.toml`, and `evaluation.toml`.

```sh
uv sync --locked --all-groups
make check
```

`make check` runs the package build, frontend build, Ruff, Pyright, and the complete test suite.

## HomeoRemedica web client

The HomeoRemedica web client uses a verified local SQLite corpus release, SQLite FTS5 and
`sqlite-vec` hybrid retrieval, OpenRouter for query embeddings, and Z.AI for grounded answer
generation. Chat history lives in the browser and can be cleared at any time; it is sent to the API
only as context for the current request.

### Quick start

Requirements:

- Python 3.14.
- [uv](https://docs.astral.sh/uv/) 0.11.x.
- Node.js and npm for the browser client.
- An [OpenRouter](https://openrouter.ai/) API key for query embeddings.
- A [Z.AI](https://z.ai/) API key for grounded answer generation.

Install dependencies:

```sh
uv sync --locked
npm --prefix frontend ci
```

Build and activate the local corpus release:

```sh
export OPENROUTER_API_KEY=... # or put it in .env
uv run --locked homeoremedica-corpus build 2026-09-12.v2
```

Build the browser client and start the web server from the repository root:

```sh
npm --prefix frontend run build
uv run homeoremedica-web
```

The server listens on port `8000` by default and reads `PORT` when it is set. It initializes and
verifies the active corpus release during startup, then serves the Vite build and the API from the
same origin. For local frontend development, run the Python server in one terminal and:

```sh
npm --prefix frontend run dev
```

The Vite development server proxies `/api` requests to `http://127.0.0.1:8000`.

The repository includes the source dataset, but the web server reads built SQLite release artifacts
rather than the source JSON directly. Build a release before starting the server, or point
`RAG_CORPUS_DIR` at a directory containing an existing local release.

### Configuration

The web server reads `RAG_*` environment variables and optional values from `.env` or `.env.local`.
Copy `.env.example` if you want a starting point:

```sh
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | OpenRouter key used for Qwen3 query and corpus embeddings. |
| `ZAI_API_KEY` | — | Z.AI key used for GLM-5.3-Flash answer generation. |
| `RAG_CORPUS_DIR` | `artifacts/corpus` | Directory containing `active.json` and local releases. |
| `RAG_MODEL` | `glm-5.3-flash` | Answer generation model. |
| `RAG_MAX_OUTPUT_TOKENS` | `700` | Maximum generated answer size. |

The web server verifies `active.json`, its manifest, the artifact digest, SQLite integrity, vector
dimensions, and release metadata during startup. Keep API keys in the environment or an ignored
`.env` file.

The API has two browser-facing endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/books` | Return available book IDs, titles, and authors. |
| `POST /api/chat` | Generate an answer from a message, optional history, and optional `bookIds`. |

Chat failures return `504` when an upstream request times out, `502` when an embedding or answer
provider fails, and `500` for an unexpected backend failure. The response contains a generic
retry message; server logs record only the failed stage, failure category, and exception type.

### Retrieval and answer flow

```text
browser
  -> web.app
      -> LocalCorpus (verified local release from RAG_CORPUS_DIR)
          -> SQLite FTS5 + sqlite-vec hybrid search
      -> HybridChatModel
          -> OpenRouter Qwen3 query embedding + Z.AI GLM-5.3-Flash grounded answer
      -> answer and stable source IDs
```

At startup, `web.app` builds one chat service and keeps it available for requests. For every
question:

1. The current message and recent browser turns form a bounded retrieval query.
2. `qwen/qwen3-embedding-8b` embeds that query through OpenRouter using the dimensions declared by
   the corpus release. The client refuses to serve a corpus built with any other embedding model.
3. FTS5 and vector search run across the selected books, then merge results with reciprocal-rank
   fusion.
4. The eight highest-ranked excerpts are passed to `glm-5.3-flash` through Z.AI's OpenAI-compatible
   chat completion API.
5. The API returns the answer, numbered citations, and the corpus version that produced them.

The active pointer identifies a versioned manifest by relative path, size, and SHA-256 digest. The
manifest identifies every local SQLite artifact and records its size, digest, source hash, schema,
embedding, SQLite, and `sqlite-vec` compatibility fields. A build exposes `active.json` only after
the complete release has been verified.

The generation instruction treats retrieved text and conversation turns as untrusted data. It
requires citations, avoids unsupported claims, and refuses diagnosis, prescribing, and dosage
advice. For urgent or severe symptoms, consult qualified medical help.

## Corpus release pipeline

The complete release pipeline and its `dataset/` input are included in every clone. Source
validation is fully local. Building requires an OpenRouter API key. The web server does not read the
source dataset directly; it uses the verified local release selected by `active.json`.

The corpus pipeline reads the remedy-merged `dataset/corpus.json` file, whose
`remedy -> book -> section -> passages` structure is validated against the configured book mapping.
It validates the complete corpus, conserves every passage, treats each passage as one symptom
chunk, generates OpenRouter Qwen3 embeddings, and writes one shared searchable SQLite
database containing every book. Each document embedding keeps the current `Book`, `Remedy`,
`Section`, and `Text` context prefix. A release becomes visible to consumers only after the database
and its immutable manifest have been written and verified.

### Validate sources locally

This command needs no API credentials. It checks that `dataset/corpus.json` matches the
configured book mapping, validates the remedy-merged sectioned schema, and reports book, passage,
chunk, and corpus-hash counts. Symlinked source files are rejected.

```sh
uv run --locked homeoremedica-corpus validate
```

## Experimental retrieval evaluation

The isolated evaluator is configured by `evaluation.toml`. It combines the query-only
`benchmarks/queries/v3.json` dataset with the configured v9 retrieval settings at depth `k = 8`,
and writes the immutable `benchmarks/results/v9.json` experiment result. It embeds the 2,117 symptom
strings from 500 clinical cases separately, with a retrieval instruction prepended to each semantic
query. Per-symptom semantic and
lexical candidates are min-max normalized from their cosine-similarity and BM25 relevance scores.
The normalized scores are squared to suppress weak tail matches and summed by the corpus-wide
normalized remedy identity across symptoms and retrieval channels, so strong evidence from different
chunks and books reinforces one remedy. The cases carry remedy-level relevance targets (`bookId` +
`remedyName`): the book validates that the labelled source exists, while the remedy name is the
scored intent and can be satisfied by evidence from any book. Chunk and book-remedy ranking remain
available with legacy reciprocal-rank fusion for older evaluation datasets.

The three query datasets are versioned independently from the nine results: query v1 supplies result
v1–v2, query v2 supplies result v3, and query v3 supplies result v4–v9. Query files contain only
their version, queries, and relevance labels. Each result records `queryVersion` and `querySha256`,
plus the SHA-256 of its former combined query/settings file as `historicalDatasetSha256`.

V8 preserves all v7 queries, labels, candidate limits, and the 80% quality threshold. It normalizes
global remedy identities using Unicode NFKC, case folding, and collapsed whitespace, so names such
as `Sulphur` and `SULPHUR` share evidence and a result slot. It does not infer synonyms, and source
names and book-level label validation remain literal. Lexical queries omit common function words
that otherwise accumulate irrelevant matches in an FTS5 OR search. Explicit negation, timing and
direction words, and modalities such as `not`, `before`, `after`, `down`, `better`, and `worse` remain.
Semantic queries retain every word. Older datasets default to exact identity and raw lexical input.

V9 retains v8's queries, labels, lexical search, document embeddings, fusion settings, and quality
threshold. It uses Qwen's documented `Instruct: ...\nQuery:...` query format with the task configured
in `evaluation.toml` and recorded as `semanticQueryInstruction` in the result. This conditions the embedding on
retrieving matching materia medica passages. The original symptom text remains intact after the
prefix, and lexical queries receive no instruction. Configurations without this field keep raw query
embeddings. See the [Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-8B#usage).

The recorded v8 Recall@8 is **20.77%**, compared with v7's **14.40%**. Scoring the original v7 results
with normalized labels alone gives **16.30%**; the remaining gain reflects changed retrieval and
evidence aggregation. The detailed
[comparison](benchmarks/results/v8-comparison.json) includes per-query rankings, an identity-only ablation,
and an exploratory split with no shared exact symptom text between development and validation.
Validation recall rises from 17.82% (v7 with normalized labels) to 19.86% in v8.

V9 reaches **24.57% Recall@8**, with validation recall increasing to **25.61%** and development
recall increasing from 21.76% to 23.43%. The [v9 comparison](benchmarks/results/v9-comparison.json) preserves
per-query rankings; [experiment results](benchmarks/results/v9-experiments.json) also record rejected
scoring and reranking approaches. This remains an exploratory benchmark comparison, and v9 still
falls below the unchanged 80% experimental threshold. These versions change the evaluator; the web
client's existing chunk-level RRF search and raw query embeddings are a separate path.

Versioned benchmark results are immutable; rerunning the evaluator against an existing result
refuses to overwrite it.

```sh
export OPENROUTER_API_KEY=... # or put it in .env
uv run --locked homeoremedica-evaluation
```

The corpus is loaded from the remedy-merged `dataset/corpus.json`, which the evaluator validates
against the configured book mapping. V9 evaluates only the model's native 4096 dimensions. It
embeds contextualized symptom chunks and instructed query symptoms, and retrieves up to 640
candidates per symptom from semantic and Porter-stemmed FTS5
search. The ranked remedy identity does not replace the underlying chunk, book, section, or passage
metadata used for evidence and citations. Inputs are sent in bounded batches. Native vectors and
scored candidate rankings are cached under `.cache/benchmarks/`, keyed by the corpus, model,
dimensions, retrieval policy, and complete ordered inputs. Later fusion experiments can therefore
reuse the paid embeddings and skip the exhaustive vector scan.

Every ranking strategy (lexical, semantic, and fused) is scored at depth 8 with five metrics:

- **Recall@8** — intent coverage: the fraction of the query's relevance targets with at least one
  matching ranked item in the top 8 (the experimental acceptance metric). Passage-level targets make this
  equal classic recall; remedy-level targets count a target as soon as the prescribed remedy
  appears.
- **MRR@8** — the mean reciprocal rank of the first relevant item in the top 8.
- **nDCG@8** — binary-relevance discounted cumulative gain with the standard log2 rank discount,
  normalized by the ideal ranking.
- **α-nDCG@8** — the novelty- and diversity-biased nDCG of Clarke et al. (SIGIR 2008) with
  α = 0.5: every relevance target is treated as one intent of its query, and each repeated
  coverage of an already-satisfied intent contributes its gain multiplied by (1 − α). The
  normalizer is the greedy ideal α-DCG over all relevant items.
- **Evidence Precision@8** — the expected fraction of the top 8 slots that supply novel evidence:
  each relevance target is one equally weighted intent, a ranked item contributes the
  (1 − α)-discounted share of the intents it covers that higher-ranked items have not already
  satisfied, and the top-8 total is scaled by 1/8. With one intent and no repeated coverage this
  reduces to precision@8.

The result records lexical, semantic, and fused values for every metric, plus candidate recall at
the configured pool depth to distinguish candidate-generation misses from top-8 ordering errors.
It is never overwritten. Evaluation results and caches are not release inputs. See
[evaluation promotion](docs/evaluation-promotion.md) for the separately tested process that moves a
successful experiment into chat.

## Build local chat releases

### Build a complete release

Choose a unique corpus version, then run:

```sh
export OPENROUTER_API_KEY=... # or put it in .env
uv run --locked homeoremedica-corpus build 2026-09-12.v2
```

Before the first embedding call, the builder validates every source and estimates every labelled
chunk's token count with a conservative four-characters-per-token bound, because OpenRouter exposes
no token-counting endpoint. The embedding response's reported token usage is checked again against
the configured 32768-token input limit, and an oversized input fails the complete build before
artifact creation. Token counting and embeddings use 32 bounded workers by default; use
`--workers` to lower concurrency for a more restrictive OpenRouter quota. Requests retry
transient failures with exponential backoff.

The complete local release appears atomically under `artifacts/corpus/2026-09-12.v2/` and contains:

- `corpus.sqlite` containing every configured book, with each chunk retaining its `bookId`;
- `manifest.json` with local sizes, SHA-256 digests, source hashes, and compatibility fields.

The corpus root also contains `active.json`, which points to the newly built release. The pointer is
updated atomically after the database and manifest pass validation.

The database contains a `books` table with source attribution, immutable chunk metadata and source
text, a shared FTS5 index, a shared cosine `sqlite-vec` index, and artifact metadata. The builder
validates SQLite integrity, FTS lookup, vector lookup, counts, versions, dimensions, normalization,
book completeness, and exact source-derived rows. Runtime search applies optional `bookIds` filters
inside this database before ranking results.

To activate an existing release after verifying it, use the CLI:

```sh
uv run --locked homeoremedica-corpus activate 2026-09-12.v2
```

Historical releases remain addressable while saved conversations may reference their corpus version.

## Development

Run the complete checks directly:

```sh
make check
```

Or run individual checks:

```sh
uv run --locked ruff check src tests
uv run --locked pyright
uv run --locked pytest
uv run --locked pip-audit --skip-editable
```

The test suite covers request bounds, prompt grounding, API responses and startup initialization,
source validation, corpus conservation, chunking, hybrid retrieval, evaluation, artifact
verification, local release activation, and active-pointer validation. Tests use fakes and synthetic
SQLite artifacts; they do not require API credentials or a production corpus release.

## Data and artifact distribution

The raw text and processed source corpus are included in this repository. Generated SQLite release
artifacts remain ignored because they are reproducible build outputs. Do not commit API keys,
credential files, local caches, or generated release artifacts.

## Licensing

The software and associated documentation are copyright © 2026 Rasagya Vatsal and licensed under
the [MIT License](LICENSE).

The original selection, arrangement, structure, and processing of the corpus under `dataset/` are
copyright © 2026 Rasagya Vatsal and licensed under
[CC BY 4.0](dataset/LICENSE.md), which requires attribution when applicable. The historical source
works were written by their identified authors and are not claimed as original works by Rasagya
Vatsal. Public-domain material remains public domain, and third-party notices and rights are not
superseded by the dataset license.
