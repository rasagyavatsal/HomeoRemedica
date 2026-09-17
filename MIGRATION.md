# Repository migration

## Open dataset distribution

On 2026-09-04 the project adopted open distribution for both its software and source dataset. This
repository contains the chat API and corpus-pipeline codebase, configuration, source corpus,
evaluation fixtures, release tooling, and synthetic tests:

- `src/chat/` contains the chat engine, verified local release loader, and hybrid retrieval runtime.
- `src/web/` contains the API server.
- `src/corpus/` contains source validation, chunking, artifact building, and local release activation.
- `src/eval/` contains isolated experimental retrieval, embeddings, contracts,
  configuration, and result tooling.
- `dataset/` contains the raw text, processed sectioned JSON source data, and the remedy-merged
  `corpus.json` source.
- `benchmarks/queries/` contains independently versioned query data, while
  `benchmarks/results/` contains immutable evaluation results and their supporting records.
- `corpus.toml` defines the chat corpus, embedding, compatibility, and release contract.
- `evaluation.toml` independently defines experimental inputs, embeddings, caches, and results.

The software is licensed under MIT. The protectable compilation and processing contributions in
`dataset/` are licensed under CC BY 4.0 with attribution to Rasagya Vatsal; public-domain source
material remains public domain and third-party rights are unaffected. Generated SQLite releases
remain ignored as reproducible build artifacts.

## Corpus release migration

The source file is now `dataset/corpus.json`, configured as `corpus_dataset` in both
`corpus.toml` and `evaluation.toml`. New releases contain one `corpus.sqlite` per versioned release
directory. The database keeps book IDs, titles, authors, source digests, and per-book counts in its
`books` table, and accepts optional `bookIds` filters during runtime search. Rebuild a release and
activate it with:

```sh
uv run --locked homeoremedica-corpus validate
uv run --locked homeoremedica-corpus build 2026-09-12.v2
uv run --locked homeoremedica-corpus activate 2026-09-12.v2
```
