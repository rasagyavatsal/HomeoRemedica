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

## Corpus repository consolidation

The former `homeoremedica-remedies` repository is now part of this private internal repository. Its
corpus pipeline, source datasets, evaluation fixtures, and release tooling live alongside the chat
client:

- `src/homeoremedica_corpus/` contains source validation, chunking, evaluation, artifact building,
  publication, and Cloud Storage adapters.
- `dataset/` contains the raw text and processed, sectioned JSON source data.
- `evaluation/` contains versioned retrieval queries and immutable results.
- `corpus.toml` defines the corpus, embedding, compatibility, and release contract.

Generated SQLite releases remain ignored by Git and are uploaded to the configured Storage bucket.
The former remedies repository can be archived or deleted after this consolidation is merged.

On 2026-09-04 the repository containing the corpus was made private and renamed
`HomeoRemedica-internal`. A new public `HomeoRemedica` repository was created from a fresh history.
It contains the complete client and corpus-pipeline codebase, configuration, evaluation fixtures,
and synthetic tests, but excludes `dataset/`, derived corpus artifacts, and all previous tag and
release history.

The original corpus extraction came from private monorepo commit
`08bfbc0e429ff51557f9463dc22460a373b3c4c3` on 2026-07-12. The original private monorepo remains
the history archive.
