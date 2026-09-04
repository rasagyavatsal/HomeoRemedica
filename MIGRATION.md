# Repository migration

## CLI migration

This release changes the repository from a browser product into the terminal-first
HomeoRemedica project.
The maintained entry point is now `homeoremedica`, the branded HomeoRemedica terminal client.
The `homeoremedica_chat` Python import path remains available for compatibility.

### Removed

- Browser pages, React components, CSS, image assets, and frontend build tooling.
- Browser authentication and account/session management.
- Payment checkout, balances, webhooks, and credit accounting.
- Persistent chat documents, chat-history endpoints, and related state stores.
- The HTTP transport, deployment container, and hosted application configuration.
- JavaScript dependencies, JavaScript tests, and frontend-only CI checks.

### Kept and promoted

- The verified corpus release format and cache safety checks.
- SQLite FTS5 and `sqlite-vec` hybrid retrieval.
- Vertex AI embedding and grounded answer generation.
- One-shot questions with `ask`.
- Multi-turn terminal chat with `chat`.

Interactive turns are held in memory only. `/clear` resets that context, and exiting the process
removes it. No conversation data is written. The CLI automatically writes only verified corpus artifacts to
the local cache.

## Dataset boundary

On 2026-09-04 the project adopted a public-code, private-data boundary. This repository contains
the complete client and corpus-pipeline codebase, configuration, evaluation fixtures, release
tooling, and synthetic tests:

- `src/homeoremedica_corpus/` contains source validation, chunking, evaluation, artifact building,
  publication, and Cloud Storage adapters.
- `evaluation/` contains versioned retrieval queries and immutable results.
- `corpus.toml` defines the corpus, embedding, compatibility, and release contract.

Authorized maintainers place raw and processed corpus sources in the local, Git-ignored `dataset/`
directory when running the corpus pipeline. Dataset contents and derived corpus artifacts are
excluded from public Git history. Generated SQLite releases remain ignored by Git and are uploaded
to the configured private Storage bucket. Corpus revisions distributed before this boundary was
adopted remain previously disclosed and cannot retroactively be made confidential.
