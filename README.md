# HomeoRemedica

HomeoRemedica is an open-source Python project containing a terminal client and the complete source
pipeline for a grounded reference assistant covering four classical homoeopathic materia medica
books: Clarke, Boericke, Kent, and Allen. Answers are generated from retrieved corpus excerpts and
include stable source IDs. The output is a study reference, not medical advice.

The software is available under the MIT License. The raw and processed corpus under `dataset/` is
included in the repository and its original compilation and processing are available under the
Creative Commons Attribution 4.0 International License (CC BY 4.0). Hosted Google Cloud resources
remain separate from the repository and require their own credentials where applicable.

## Repository layout

- `src/chat/` — terminal `ask`, `chat`, and corpus-cache client.
- `src/corpus/` — source validation, chunking, release building, and Cloud Storage
  publication pipeline.
- `src/eval/` — isolated experimental retrieval, embedding, configuration,
  contracts, and result tooling.
- `dataset/raw-text/` — source text for the four books.
- `dataset/processed/` — validated per-book sectioned JSON sources.
- `dataset/combined.json` — the remedy-merged corpus file consumed by the pipeline.
- `evaluation/` — versioned retrieval queries and immutable evaluation results.
- `corpus.toml` — chat release configuration.
- `evaluation.toml` — experimental evaluation inputs, embeddings, and output locations.

The `chat`, `corpus`, and `eval` Python packages are built and tested together from the repository
root. The project and CLI remain branded `HomeoRemedica`.

## Reproducible environment

Python 3.14.3, dependencies, SQLite 3.53.4, and pre-1.0 `sqlite-vec` 0.1.9 are pinned by
`.python-version`, `uv.lock`, `corpus.toml`, and `evaluation.toml`.

```sh
uv sync --locked --all-groups
make check
```

`make check` runs the package build, Ruff, Pyright, and the complete test suite. CI runs the same
gates.

## HomeoRemedica client

The HomeoRemedica client uses verified corpus releases from Google Cloud Storage, local SQLite FTS5 and
`sqlite-vec` hybrid retrieval, OpenRouter for query embeddings, and Vertex AI for grounded answer
generation. There is no browser application, account system, payment flow, persistent chat store, or
HTTP endpoint. Interactive context is discarded when the command exits.

### Quick start

Requirements:

- Python 3.14.
- [uv](https://docs.astral.sh/uv/) 0.11.x.
- An [OpenRouter](https://openrouter.ai/) API key for query embeddings.
- Google Cloud Application Default Credentials with permission to call Vertex AI in your selected
  project.
- Permission to read the configured corpus bucket when using `sync` against a hosted release.

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
subsequent questions without another corpus download after a successful sync; OpenRouter and Vertex
AI still need network access for embeddings and generation.

The repository includes the source dataset, but the chat client reads built SQLite release
artifacts rather than the source JSON directly. You can use an accessible hosted release or run the
evaluation, build, and publication pipeline against Google Cloud resources you control.

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
| `OPENROUTER_API_KEY` | — | OpenRouter key used for Qwen3 query and corpus embeddings. |
| `RAG_PROJECT` | `homeoremedica` | Google Cloud project used for corpus storage and Vertex AI. |
| `RAG_LOCATION` | `us-central1` | Vertex AI location. |
| `RAG_BUCKET` | `homeoremedica-private-remedies` | Corpus artifact bucket. |
| `RAG_CORPUS_PREFIX` | `corpora` | Release prefix inside the bucket. |
| `RAG_CACHE_DIR` | `~/.cache/homeoremedica/corpus` | Local verified release cache. |
| `RAG_MODEL` | `gemini-2.5-flash-lite` | Answer generation model. |
| `RAG_MAX_OUTPUT_TOKENS` | `700` | Maximum generated answer size. |

The CLI uses Google Application Default Credentials for generation and corpus storage. Do not put
service-account private keys in `.env` or commit credential files.

### Retrieval and answer flow

```text
terminal
  -> chat.cli
      -> CorpusCache (verified local release)
          -> SQLite FTS5 + sqlite-vec hybrid search
      -> HybridChatModel
          -> OpenRouter Qwen3 query embedding + Vertex AI grounded answer
      -> answer and stable source IDs
```

For every question:

1. The current message and recent in-process turns form a bounded retrieval query.
2. `qwen/qwen3-embedding-8b` embeds that query through OpenRouter using the dimensions declared by
   the corpus release. The client refuses to serve a corpus built with any other embedding model.
3. FTS5 and vector search run across the selected books, then merge results with reciprocal-rank
   fusion.
4. The eight highest-ranked excerpts are passed to `gemini-2.5-flash-lite`.
5. The answer is printed with numbered citations and the corpus version that produced them.

`sync` validates the active pointer, manifest, object generations, sizes, SHA-256 digests, schema
metadata, SQLite integrity, and vector dimensions before activating a release. An interrupted
download cannot replace the active cache.

The generation instruction treats retrieved text and conversation turns as untrusted data. It
requires citations, avoids unsupported claims, and refuses diagnosis, prescribing, and dosage
advice. For urgent or severe symptoms, consult qualified medical help.

## Corpus release pipeline

The complete release pipeline and its `dataset/` input are included in every clone. Source
validation is fully local. Building requires an OpenRouter API key, and publication requires write
access to the destination Storage bucket. The `sync`, `ask`, and `chat` commands do not read the
source dataset directly; they use an accessible hosted release or an existing verified cache.

The corpus pipeline reads the remedy-merged `dataset/combined.json` file, whose
`remedy -> book -> section -> passages` structure is validated against the configured book mapping.
It validates the complete corpus, conserves every passage, treats each passage as one symptom
chunk, generates OpenRouter Qwen3 embeddings, and writes one independently searchable SQLite
artifact per book. Each document embedding keeps the current `Book`, `Remedy`, `Section`, and
`Text` context prefix. A release becomes visible to consumers only after every artifact and its
immutable manifest have been uploaded and verified.

### Validate sources locally

This command needs no cloud credentials. It checks that `dataset/combined.json` matches the
configured book mapping, validates the remedy-merged sectioned schema, and reports book, passage,
chunk, and corpus-hash counts. Symlinked source files are rejected.

```sh
uv run --locked homeoremedica-corpus validate
```

## Experimental retrieval evaluation

The isolated evaluator is configured by `evaluation.toml`. It reads
`evaluation/v9/queries.json` at depth `k = 8` and writes the immutable
`evaluation/v9/result.json` experiment result. It embeds the 2,117 symptom strings from 500 clinical
cases separately, with a retrieval instruction prepended to each semantic query. Per-symptom semantic and
lexical candidates are min-max normalized from their cosine-similarity and BM25 relevance scores.
The normalized scores are squared to suppress weak tail matches and summed by the corpus-wide
normalized remedy identity across symptoms and retrieval channels, so strong evidence from different
chunks and books reinforces one remedy. The cases carry remedy-level relevance targets (`bookId` +
`remedyName`): the book validates that the labelled source exists, while the remedy name is the
scored intent and can be satisfied by evidence from any book. Chunk and book-remedy ranking remain
available with legacy reciprocal-rank fusion for older evaluation datasets.

V8 preserves all v7 queries, labels, candidate limits, and the 80% quality threshold. It normalizes
global remedy identities using Unicode NFKC, case folding, and collapsed whitespace, so names such
as `Sulphur` and `SULPHUR` share evidence and a result slot. It does not infer synonyms, and source
names and book-level label validation remain literal. Lexical queries omit common function words
that otherwise accumulate irrelevant matches in an FTS5 OR search. Explicit negation, timing and
direction words, and modalities such as `not`, `before`, `after`, `down`, `better`, and `worse` remain.
Semantic queries retain every word. Older datasets default to exact identity and raw lexical input.

V9 retains v8's queries, labels, lexical search, document embeddings, fusion settings, and quality
threshold. It uses Qwen's documented `Instruct: ...\nQuery:...` query format with the task recorded
in `semanticQueryInstruction` in both the dataset and result. This conditions the embedding on
retrieving matching materia medica passages. The original symptom text remains intact after the
prefix, and lexical queries receive no instruction. Datasets without this field keep raw query
embeddings. See the [Qwen model card](https://huggingface.co/Qwen/Qwen3-Embedding-8B#usage).

The recorded v8 Recall@8 is **20.77%**, compared with v7's **14.40%**. Scoring the original v7 results
with normalized labels alone gives **16.30%**; the remaining gain reflects changed retrieval and
evidence aggregation. The detailed
[comparison](evaluation/v8/comparison.json) includes per-query rankings, an identity-only ablation,
and an exploratory split with no shared exact symptom text between development and validation.
Validation recall rises from 17.82% (v7 with normalized labels) to 19.86% in v8.

V9 reaches **24.57% Recall@8**, with validation recall increasing to **25.61%** and development
recall increasing from 21.76% to 23.43%. The [v9 comparison](evaluation/v9/comparison.json) preserves
per-query rankings; [experiment results](evaluation/v9/experiments.json) also record rejected
scoring and reranking approaches. This remains an exploratory benchmark comparison, and v9 still
falls below the unchanged 80% experimental threshold. These versions change the evaluator; the terminal
client's existing chunk-level RRF search and raw query embeddings are a separate path.

To reproduce the comparison after populating both versions' candidate caches, without network calls:

```sh
uv run --locked python scripts/compare_v8_retrieval.py
uv run --locked python scripts/compare_v9_retrieval.py
```

The default comparison outputs are `.cache/evaluation/v8-comparison.json` and `v9-comparison.json`.
Versioned evaluation results are immutable; rerunning the evaluator against an existing result
refuses to overwrite it.

```sh
export OPENROUTER_API_KEY=... # or put it in .env
uv run --locked homeoremedica-evaluation
```

The corpus is loaded from the remedy-merged `dataset/combined.json`, which the evaluator validates
against the configured book mapping. V9 evaluates only the model's native 4096 dimensions. It
embeds contextualized symptom chunks and instructed query symptoms, and retrieves up to 640
candidates per symptom from semantic and Porter-stemmed FTS5
search. The ranked remedy identity does not replace the underlying chunk, book, section, or passage
metadata used for evidence and citations. Inputs are sent in bounded batches. Native vectors and
scored candidate rankings are cached under `.cache/evaluation/`, keyed by the corpus, model,
dimensions, retrieval policy, and complete ordered inputs. Later fusion experiments can therefore
reuse the paid embeddings and skip the exhaustive vector scan.

With the document embedding cache already present, you can prepare semantic candidates using
NumPy's exhaustive cosine search over document blocks. This optional development tool limits the
document working set and reuses the same candidate-cache contract as the evaluator. It searches
every vector; floating-point rounding and ties may differ from sqlite-vec. Its raw-query baseline
reproduced v8's recorded recall, and synthetic tests compare its scores and rankings with sqlite-vec.

```sh
# --embed-queries permits OpenRouter calls only if these query embeddings are missing.
uv run --locked python scripts/prepare_semantic_candidates.py --embed-queries
uv run --locked homeoremedica-evaluation
```

Omit `--embed-queries` for cache-only operation. This command preserves existing candidate files;
changing the instruction generates new query-embedding and semantic-candidate cache keys while
reusing the document and lexical caches. NumPy is a development dependency, not a runtime dependency
of the terminal client.

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

## Build and publish chat releases

### Build a complete release

Choose a unique corpus version, then run:

```sh
export OPENROUTER_API_KEY=... # or put it in .env
uv run --locked homeoremedica-corpus build 2026-08-14.v1
```

Before the first embedding call, the builder validates every source and estimates every labelled
chunk's token count with a conservative four-characters-per-token bound, because OpenRouter exposes
no token-counting endpoint. The embedding response's reported token usage is checked again against
the configured 32768-token input limit, and an oversized input fails the complete build before
artifact creation. Token counting and embeddings use 32 bounded workers by default; use
`--workers` to lower concurrency for a more restrictive OpenRouter quota. Requests retry
transient failures with exponential backoff.

The complete local release appears atomically under `output/releases/2026-08-14.v1/` and contains:

- `books/<book-id>.sqlite` for every configured processed book;
- `build.json` with local sizes, SHA-256 digests, source hashes, and compatibility fields.

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
schema, SQLite, `sqlite-vec`, and source compatibility fields.

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

## Data and artifact distribution

The raw text and processed source corpus are included in this repository. Generated SQLite release
artifacts remain ignored because they are reproducible build outputs and are published separately
to a configured Storage bucket. A bucket's access policy is independent of the open licenses in
this repository. Do not commit credentials, service-account keys, signed object URLs, local caches,
or generated release artifacts.

## Licensing

The software and associated documentation are copyright © 2026 Rasagya Vatsal and licensed under
the [MIT License](LICENSE).

The original selection, arrangement, structure, and processing of the corpus under `dataset/` are
copyright © 2026 Rasagya Vatsal and licensed under
[CC BY 4.0](dataset/LICENSE.md), which requires attribution when applicable. The historical source
works were written by their identified authors and are not claimed as original works by Rasagya
Vatsal. Public-domain material remains public domain, and third-party notices and rights are not
superseded by the dataset license.
