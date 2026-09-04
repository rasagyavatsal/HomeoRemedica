# HomeoRemedica client

This repository is a sanitized public source mirror of the HomeoRemedica internal terminal client.
It contains client code and synthetic tests only. The source corpus, processed dataset, evaluation
records, release artifacts, and corpus build and publication pipeline are private and are not
distributed from this repository.

HomeoRemedica is a grounded reference assistant for classical homoeopathic materia medica. Its
output is a historical study reference, not medical advice.

## Access model

The CLI is an internal tool. A public clone can be built and tested, but `sync`, `ask`, and `chat`
require both Google Application Default Credentials and explicit IAM access to HomeoRemedica's
private Cloud Storage and Vertex AI resources. Cloning this repository grants no such access.

Authorized operators can authenticate with:

```sh
gcloud auth application-default login
uv run homeoremedica sync
uv run homeoremedica --cached ask "How is Nux vomica described?"
uv run homeoremedica --cached chat
```

Never place service-account keys, signed corpus URLs, cached corpus databases, or corpus excerpts
in this repository.

## Development

The project uses Python 3.14 and `uv`:

```sh
uv sync --locked --all-groups
make check
```

The public test suite uses generated, synthetic SQLite fixtures. It requires neither cloud
credentials nor access to the production corpus.

## Public repository boundary

The following are intentionally excluded:

- `dataset/` and `evaluation/`;
- `src/homeoremedica_corpus/` and `corpus.toml`;
- generated SQLite databases, manifests, caches, and release archives;
- production credentials and environment-specific access configuration.

`make check` enforces this boundary before running the build, lint, type-check, and test gates.
If you discover corpus material or credentials in this repository, follow `SECURITY.md` and do not
open a public issue containing the material.
