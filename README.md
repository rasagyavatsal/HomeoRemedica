# HomeoRemedica

HomeoRemedica is a public Python codebase containing a terminal client and the complete source
pipeline for a grounded reference assistant covering four classical homoeopathic materia medica
books: Clarke, Boericke, Kent, and Allen. Answers are generated from retrieved corpus excerpts and
include stable source IDs. The output is a study reference, not medical advice.

The code, configuration, evaluation tooling, and synthetic tests are public. The raw and processed
corpus under `dataset/`, generated corpus databases, and published release objects are private and
are not distributed from this repository. Cloning the codebase grants no Google Cloud access.

## Repository layout

- `src/homeoremedica_chat/` — terminal `ask`, `chat`, and corpus-cache client.
- `src/homeoremedica_corpus/` — source validation, chunking, evaluation, release building, and
  Cloud Storage publication pipeline.
- `dataset/raw-text/` — private source text for the four books; not present in public clones.
- `dataset/processed/` — private validated JSON used by the pipeline; not present in public clones.
- `evaluation/` — versioned retrieval queries and immutable evaluation results.
- `corpus.toml` — corpus, embedding, compatibility, and release configuration.

The two Python packages are built and tested together from the repository root.
The `homeoremedica_chat` import path is retained for Python compatibility. The project and CLI are
branded `HomeoRemedica`.

## Reproducible environment

Python 3.14.3, dependencies, SQLite 3.53.4, and pre-1.0 `sqlite-vec` 0.1.9 are pinned by
`.python-version`, `uv.lock`, and `corpus.toml`.

```sh
uv sync --locked --all-groups
make check
```

`make check` runs the package build, Ruff, Pyright, and the complete test suite. CI runs the same
gates.

## HomeoRemedica client

The HomeoRemedica client uses verified corpus releases from Google Cloud Storage, local SQLite FTS5 and
`sqlite-vec` hybrid retrieval, and Vertex AI for query embeddings and grounded answer generation.
There is no browser application, account system, payment flow, persistent chat store, or HTTP
endpoint. Interactive context is discarded when the command exits.

### Quick start

Requirements:

- Python 3.14.
- [uv](https://docs.astral.sh/uv/) 0.11.x.
- Google Cloud Application Default Credentials with permission to read the configured corpus
  bucket and call Vertex AI in `homeoremedica`.

Install dependencies and authenticate:

```sh
uv sync --locked
gcloud auth application-default login
```

Download and verify the active corpus release:

```sh
uv run homeoremedica sync
```

Ask one question:

```sh
uv run homeoremedica --cached ask "How is Nux vomica described?"
```

Start a conversation:

```sh
uv run homeoremedica --cached chat
```

The sync command checks for a newer release and reuses unchanged artifacts. Use `--cached` before
the subcommand to skip Cloud Storage and use the last verified local release. This is useful for
subsequent questions without another corpus download after a successful sync; Vertex AI still needs
network access for embeddings and generation.

The `homeoremedica` command is the canonical installed entry point.

### Commands

| Command | Purpose |
| --- | --- |
| `sync` | Download and verify the active corpus release. |
| `ask "question"` | Answer one question and exit. |
| `chat` | Run an interactive multi-turn conversation. |

Common options go before the subcommand:

```sh
# Override the corpus project or cache location for one invocation.
uv run homeoremedica --project homeoremedica --cache-dir ~/.cache/homeoremedica/corpus sync

# Restrict retrieval to one or more books.
uv run homeoremedica --cached ask --book kent-lectures "What is described?"
uv run homeoremedica --cached chat --book clarke-MM --book boericke-MM
```

Valid book IDs are:

- `clarke-MM`
- `boericke-MM`
- `kent-lectures`
- `allen-nosodes`

In interactive mode, `/clear` removes the current in-memory conversation context. `/exit`,
`/quit`, or `Ctrl-D` leave the client.

### Configuration

The CLI reads `RAG_*` environment variables and optional values from `.env` or `.env.local`.
Copy `.env.example` if you want a starting point:

```sh
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `RAG_PROJECT` | `homeoremedica` | Google Cloud project used for corpus storage and Vertex AI. |
| `RAG_LOCATION` | `us-central1` | Vertex AI location. |
| `RAG_BUCKET` | `homeoremedica-private-remedies` | Corpus artifact bucket. |
| `RAG_CORPUS_PREFIX` | `corpora` | Release prefix inside the bucket. |
| `RAG_CACHE_DIR` | `~/.cache/homeoremedica/corpus` | Local verified release cache. |
| `RAG_MODEL` | `gemini-2.5-flash-lite` | Answer generation model. |
| `RAG_MAX_OUTPUT_TOKENS` | `700` | Maximum generated answer size. |

The CLI uses Google Application Default Credentials. Do not put service-account private keys in
`.env` or commit credential files.

### Retrieval and answer flow

```text
terminal
  -> homeoremedica_chat.cli
      -> CorpusCache (verified local release)
          -> SQLite FTS5 + sqlite-vec hybrid search
      -> VertexChatModel
          -> Gemini query embedding + grounded answer
      -> answer and stable source IDs
```

For every question:

1. The current message and recent in-process turns form a bounded retrieval query.
2. `gemini-embedding-001` embeds that query using the dimensions declared by the corpus release.
3. FTS5 and vector search run across the selected books, then merge results with reciprocal-rank
   fusion.
4. The eight highest-ranked excerpts are passed to `gemini-2.5-flash-lite`.
5. The answer is printed with numbered citations and the corpus version that produced them.

`sync` validates the active pointer, manifest, object generations, sizes, SHA-256 digests, schema
metadata, retrieval evaluation, SQLite integrity, and vector dimensions before activating a
release. An interrupted download cannot replace the active cache.

The generation instruction treats retrieved text and conversation turns as untrusted data. It
requires citations, avoids unsupported claims, and refuses diagnosis, prescribing, and dosage
advice. For urgent or severe symptoms, consult qualified medical help.

## Corpus pipeline

The pipeline source is public. Authorized maintainers keep its private `dataset/` input in a local,
Git-ignored directory. Validation, evaluation, and build commands require that local dataset;
publication also requires access to the configured Google Cloud project. The `sync`, `ask`, and
`chat` commands do not read the source dataset, but they do require an authorized private release
or an existing verified local cache.

The corpus pipeline reads only direct `dataset/processed/*.json` files using the sectioned
`remedy -> section -> passages` schema. It validates the complete corpus, conserves every passage,
creates stable boundary-safe chunks, generates Vertex AI embeddings, and writes one independently
searchable SQLite artifact per book. A release becomes visible to consumers only after every
artifact and its immutable manifest have been uploaded and verified.

### Validate sources locally

This command needs no cloud credentials. It checks that the configured book mapping exactly
matches `dataset/processed/*.json`, validates the sectioned schema, and reports book, passage,
chunk, and corpus-hash counts. Symlinked source files are rejected.

```sh
uv run --locked homeoremedica-corpus validate
```

### Retrieval evaluation

The evaluator reads `evaluation/v2/queries.json` and writes the immutable
`evaluation/v2/result.json` release input:

```sh
uv run --locked homeoremedica-corpus evaluate \
  --project YOUR_PROJECT_ID \
  --location us-central1
```

The evaluator compares 768, 1536, and 3072 dimensions against the same corpus, uses
`RETRIEVAL_DOCUMENT` for labelled chunks and `RETRIEVAL_QUERY` for queries, and combines semantic
and Porter-stemmed FTS5 candidates with reciprocal-rank fusion. Because `gemini-embedding-001`
supports Matryoshka prefixes, one 3072-dimensional request per input supplies all three normalized
dimensions. The result records lexical, semantic, and fused recall and MRR and is never overwritten.
The builder rejects a stale evaluation, a changed dataset digest, or a configured dimension that
differs from the recorded choice.

The v2 evaluation records fused recall@10 of `0.8333` at 1536 dimensions, the smallest evaluated
dimension meeting the `0.8` release threshold. `corpus.toml` pins that approved dimension.

### Build a complete release

Choose a unique corpus version, then run:

```sh
uv run --locked homeoremedica-corpus build 2026-08-14.v1 \
  --project YOUR_PROJECT_ID \
  --location us-central1
```

Before the first embedding call, the builder validates every source and asks the regional Vertex
AI endpoint for the exact token count of every labelled chunk. Embedding requests set
`auto_truncate=false`. An oversized input therefore fails the complete build before embedding or
artifact creation. Token counts and embeddings use 32 bounded workers by default; use `--workers`
to lower concurrency for a more restrictive Vertex AI quota.

The complete local release appears atomically under `output/releases/2026-08-14.v1/` and contains:

- `books/<book-id>.sqlite` for every configured processed book;
- `build.json` with local sizes, SHA-256 digests, source hashes, evaluation identity, and shared
  compatibility fields.

Each database contains immutable chunk metadata and source text, an FTS5 index, a cosine
`sqlite-vec` index, and artifact metadata. The builder validates SQLite integrity, FTS lookup,
vector lookup, counts, versions, dimensions, normalization, and exact source-derived rows.

### Publish and activate

```sh
uv run --locked homeoremedica-corpus publish 2026-08-14.v1 \
  --bucket YOUR_CORPUS_BUCKET
```

Artifacts are uploaded to unique `corpora/<corpus-version>/books/` objects with the Cloud Storage
create-only generation precondition. The publisher downloads and SHA-256-verifies every exact
object generation, creates an immutable manifest, verifies the complete remote release again, and
only then replaces `corpora/active.json`. The pointer update uses the generation captured before
staging, so a concurrent publisher wins at most once; a loser cannot overwrite the newer pointer.
Failed staging can leave unreachable immutable objects but cannot expose a partial corpus.

The active pointer identifies the manifest by object name, generation, byte size, and digest. The
manifest identifies every book artifact by object name and generation and records all embedding,
schema, SQLite, `sqlite-vec`, evaluation, and source compatibility fields.

### Roll back

Rollback only repoints the active pointer to an already verified immutable manifest:

```sh
uv run --locked homeoremedica-corpus rollback 2026-08-14.previous \
  --bucket YOUR_CORPUS_BUCKET
```

There is intentionally no deletion or overwrite command. Historical manifests and book artifacts
remain addressable while saved conversations may reference their corpus version.

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

The test suite covers request bounds, prompt grounding, CLI output, interactive context handling,
source validation, corpus conservation, chunking, hybrid retrieval, evaluation, artifact
verification, publication fencing, and cache activation. Tests use fakes and synthetic SQLite
artifacts; they do not require cloud credentials or a production corpus release.

## Data boundary

All application and corpus-pipeline source code, compatibility configuration, evaluation fixtures,
and synthetic tests are maintained in this public repository. Raw and processed corpus source data
are kept outside public Git history and can be placed in the ignored local `dataset/` directory by
authorized maintainers. Generated SQLite release artifacts are ignored by Git and published to the
private configured Storage bucket. The chat CLI downloads only verified artifacts permitted by
Google Cloud IAM.

Do not commit `dataset/`, generated corpus artifacts, credentials, service-account keys, or signed
object URLs. See `DATA_NOTICE.md` before distributing any source or derived corpus asset.
