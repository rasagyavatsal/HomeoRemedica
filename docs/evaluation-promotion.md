# Evaluation isolation and promotion

Evaluation is an experimental pipeline. Chat and corpus releases must remain usable when evaluation
code, settings, caches, or recorded results change or are absent. Both pipelines may read
`dataset/combined.json`; the source schema and deterministic chunking code are the only intentional
shared inputs.

## Dependency audit

The audit found four concrete couplings in the previous layout:

- The evaluator lived inside the corpus package and imported release embedding, retrieval,
  contract, and path modules, while experiment scripts imported private helpers from the corpus CLI.
- `corpus.toml` mixed release dimensions and paths with evaluation dimensions, datasets, and result
  paths.
- Local manifests and chat releases no longer depend on an `EvaluationGate`.
- Artifact construction imported its FTS tokenizer constant from the evaluator's retrieval module.

Those dependencies are now assigned as follows:

| Concern | Chat and release owner | Evaluation owner | Boundary |
| --- | --- | --- | --- |
| Retrieval | `chat.corpus` | `eval.retrieval` | Neither imports the other. |
| Query embeddings | `corpus.embeddings`, used by the current chat runtime | `eval.embeddings` | Provider code and constants are independent. |
| Configuration | `corpus.toml` and `corpus.config` | `evaluation.toml` and `eval.config` | Evaluation settings are rejected by the release config schema. |
| Contracts and utilities | Chat/release manifest contracts | Evaluation result contracts and path helpers | Evaluation results are not present in new build descriptors or manifests. |
| Outputs | `artifacts/corpus/` | `benchmarks/` and `.cache/benchmarks/` | Experimental files cannot become release artifacts implicitly. |
| Source data | `dataset/combined.json` through corpus source/chunking modules | The same file through the same deterministic source/chunking modules | Reading the same source does not couple runtime behavior. |

The repository boundary check parses package imports and both TOML files. The `chat` and `eval`
packages may import `corpus`; `corpus` imports neither of them, `eval` does not import `chat`, and
production packages cannot import `eval`. Corpus releases contain only source, artifact, and
runtime compatibility metadata.

## Promoting an experiment

A successful evaluation result does not change chat or authorize a release. Promotion is a separate
implementation change:

1. Record the experiment, its query version and hash, settings, caches needed for reproduction,
   metrics, and limitations under `benchmarks/results/`.
2. Implement the selected behavior in the chat-owned retrieval or embedding path. Copy the specific
   behavior and its stable parameters; do not add an import from `eval`.
3. Add focused chat tests for the promoted behavior, including a before/after retrieval fixture and
   manifest compatibility checks when embedding or artifact metadata changes. Keep evaluation tests
   as independent evidence for the experiment.
4. Update `corpus.toml` only in that promotion change, then run `make check`. The import-boundary
   test, existing chat suite, release build tests, and the new behavior test must all pass.
5. Build and activate a new corpus version through the normal corpus command. Release validation
   checks the artifacts and compatibility contract without reading evaluation results.

This makes the reviewable chat implementation and its tests the promotion decision. A benchmark
file alone can never alter a chat release.
