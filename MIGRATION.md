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

## Open dataset distribution

On 2026-09-04 the project adopted open distribution for both its software and source dataset. This
repository contains the complete client and corpus-pipeline codebase, configuration, source corpus,
evaluation fixtures, release tooling, and synthetic tests:

- `src/homeoremedica_corpus/` contains source validation, chunking, evaluation, artifact building,
  publication, and Cloud Storage adapters.
- `dataset/` contains the raw text and processed, sectioned JSON source data.
- `evaluation/` contains versioned retrieval queries and immutable results.
- `corpus.toml` defines the corpus, embedding, compatibility, and release contract.

The software is licensed under MIT. The protectable compilation and processing contributions in
`dataset/` are licensed under CC BY 4.0 with attribution to Rasagya Vatsal; public-domain source
material remains public domain and third-party rights are unaffected. Generated SQLite releases
remain ignored as reproducible build artifacts and may be uploaded to a configured Storage bucket.
Access to hosted Google Cloud resources is managed separately from repository licensing.
