# HomeoRemedica

Retrieval-augmented chat over seven historical homoeopathic books (Allen, Boericke, Clarke, Hahnemann,
Kent) that answers with cited passages. Historical reference only; not medical advice.

**Live:** <https://homeoremedica-619837289655.asia-south1.run.app>

This repository is the Hono API (`src/server`) and the React web app (`src/web`). The Qdrant collections
come from [homeoremedica-private](https://github.com/rasagyavatsal/homeoremedica-private); the Android
client is [homeoremedica-android](https://github.com/rasagyavatsal/homeoremedica-android).

## Setup

Requires Node.js 22.18+ (24 recommended), a Qdrant 1.15.2+ cluster with the seven book collections, and
OpenRouter and Z.AI API keys.

```sh
npm ci
cp .env.example .env                      # then set the variables below
gcloud auth application-default login     # only for saved chats locally (Firestore)
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `QDRANT_URL` | Required for chat | Qdrant cluster URL. |
| `QDRANT_API_KEY` | None | Qdrant API key; Qdrant Cloud requires it. |
| `OPENROUTER_API_KEY` | Required for chat | Query embeddings (`voyageai/voyage-4`). |
| `ZAI_API_KEY` | Required for chat | Answer generation. |
| `RAG_MODEL` | `glm-5.3-flash` | Answer model. |
| `RAG_MAX_OUTPUT_TOKENS` | `4096` | Output token limit, 1 to 4096. |
| `FIREBASE_PROJECT_ID` | None | With `FIREBASE_API_KEY`, turns on sign-in and saved chats. |
| `FIREBASE_API_KEY` | None | Public browser key for Firebase Authentication. |
| `FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` | Hosts the Google sign-in pop-up. |
| `HOST` | `127.0.0.1` | Address `npm start` listens on. |
| `PORT` | `8000` | Port `npm start` listens on. |

Variables come from the environment, `.env` and `.env.local`.

## Run

```sh
npm run dev                 # frontend and API on http://127.0.0.1:5173; restart after editing .env
npm run build && npm start  # built frontend and API on http://127.0.0.1:8000
```

Port 5173 must be free; Vite fails rather than switching ports. The API's routes are in
`src/server/app.ts` and its request and response shapes in `src/server/contracts.ts`.

## Test

```sh
npm run check                     # type-check, unit tests (fakes, no keys or Qdrant), build
npx playwright install chromium   # once, before the e2e tests
npm run e2e                       # built app in Chromium, desktop and phone sizes
npm run e2e -- --ui               # the same, watching them run
npm run e2e:smoke                 # one real question to production with the keys in .env
```

`npm run e2e` needs no keys: `e2e/server.ts` scripts the answers, and Playwright starts the Firebase Auth
and Firestore emulators on ports 9099 and 8086, which need Java 21+. Android's e2e tests use the same
server.

## Deploy

```sh
npm run deploy   # Cloud Build, then the homeoremedica Cloud Run service in asia-south1
```

Merging release-please's PR on `main` tags a `v*` release, which runs `npm run check` and the `Deploy`
workflow; run `Deploy` by hand to redeploy without a release. The service runs one instance, so the
in-memory rate limits hold. It keeps its configuration between deploys: `QDRANT_URL` and the Firebase
variables are plain, the other keys come from Secret Manager, and `.env` is not copied into the image.

## License

Software and documentation: [MIT](LICENSE). The dataset is proprietary and lives in
[homeoremedica-private](https://github.com/rasagyavatsal/homeoremedica-private).
