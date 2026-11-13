# HomeoRemedica

Chat over seven historical homoeopathic books that answers with cited passages. Historical
reference only; not medical advice.

**Live:** <https://homeoremedica-619837289655.asia-south1.run.app>

This repository holds the server (`src/server`) and the web app (`src/web`). The Qdrant
collections it searches come from [homeoremedica-private](https://github.com/rasagyavatsal/homeoremedica-private);
the Android app is [homeoremedica-android](https://github.com/rasagyavatsal/homeoremedica-android).

## Run

Requires Node.js 22.18+, a Qdrant cluster with the book collections, and OpenRouter and Z.AI keys.

```sh
npm ci
cp .env.example .env    # fill in the keys
npm run dev             # http://127.0.0.1:5173
```

`npm run build && npm start` serves the built app and API on <http://127.0.0.1:8000>.

## Develop

```sh
npm run check           # types, tests, build
npm run e2e             # Playwright; needs Java 21 for the Firebase emulators
```

## Release

Merging release-please's PR on `main` tags a `v*` release, and the `Deploy` workflow deploys it to
Cloud Run. `npm run deploy` deploys from your machine.

## License

[MIT](LICENSE). The dataset is proprietary and not included.
