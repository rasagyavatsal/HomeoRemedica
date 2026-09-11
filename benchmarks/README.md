# Retrieval benchmarks

`queries/` contains query text and relevance labels only. Retrieval and scoring settings live in
`evaluation.toml` for the active run and in each immutable result record for historical runs.

Query datasets and results have independent version sequences:

| Results | Query dataset | Query SHA-256 |
| --- | --- | --- |
| v1–v2 | v1 | `8fcdc38d6dcf0a78de9ad481b7c1a9804535940b5f308b053dedc19aa88a722b` |
| v3 | v2 | `c799b531096d93bba8d4accd8da73fc3781d12f689d3a744d031ffe93e4147d9` |
| v4–v9 | v3 | `bbbbbeb678f40049155ce597c02defc9715d9e8d94302846ad1b86c8abce3ddb` |

Every file in `results/` records this relationship through `queryVersion` and `querySha256`.
`historicalDatasetVersion` and `historicalDatasetSha256` preserve the identity of the former files
that combined query data with retrieval settings. `corpusHash`, settings, and scores retain their
recorded values.

The v8 and v9 comparison records and the v9 experiment record sit beside the results they explain.
Result records are immutable; choose a new result version instead of overwriting an existing file.
