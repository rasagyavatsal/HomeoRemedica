# Repository migration

## Web client migration

This release moves the user-facing HomeoRemedica client from the terminal into a small browser
application. The maintained entry point is now `homeoremedica-web`, which serves the React client
and Python API from one process. The `chat` Python package continues to provide the grounded chat
engine and corpus runtime.

### Removed

- The terminal chat CLI and its `homeoremedica` entry point.
- Interactive terminal context handling.

### Kept and promoted

- The verified corpus release format and cache safety checks.
- SQLite FTS5 and `sqlite-vec` hybrid retrieval.
- OpenRouter query embeddings and Vertex AI grounded answer generation.
- The corpus pipeline and isolated evaluation tools.
- The React/Vite client, FastAPI API, and same-origin static serving.

Chat turns are held in browser memory only. Clear chat removes that context, and no conversation
data is written. The web service automatically writes only verified corpus artifacts to the local
cache.

## Open dataset distribution

On 2026-09-04 the project adopted open distribution for both its software and source dataset. This
repository contains the complete client and corpus-pipeline codebase, configuration, source corpus,
evaluation fixtures, release tooling, and synthetic tests:

- `src/chat/` contains the chat engine, verified release cache, and hybrid retrieval runtime.
- `src/web/` contains the API and production static-file server.
- `frontend/` contains the React and Vite browser client.
- `src/corpus/` contains source validation, chunking, artifact building, publication,
  and Cloud Storage adapters.
- `src/eval/` contains isolated experimental retrieval, embeddings, contracts,
  configuration, and result tooling.
- `dataset/` contains the raw text and processed, sectioned JSON source data.
- `benchmarks/queries/` contains independently versioned query data, while
  `benchmarks/results/` contains immutable evaluation results and their supporting records.
- `corpus.toml` defines the chat corpus, embedding, compatibility, and release contract.
- `evaluation.toml` independently defines experimental inputs, embeddings, caches, and results.

The software is licensed under MIT. The protectable compilation and processing contributions in
`dataset/` are licensed under CC BY 4.0 with attribution to Rasagya Vatsal; public-domain source
material remains public domain and third-party rights are unaffected. Generated SQLite releases
remain ignored as reproducible build artifacts and may be uploaded to a configured Storage bucket.
Access to hosted Google Cloud resources is managed separately from repository licensing.
