# HomeoRemedica for Android

A native Android client for [HomeoRemedica](https://github.com/rasagyavatsal/HomeoRemedica), the
retrieval-augmented chat over historical homoeopathic materia medica. It asks the same questions of the
same seven books and shows the same cited answers as the web app. Historical reference only; not medical
advice.

**Stack:** Kotlin · Jetpack Compose (foundation only, no Material) · OkHttp · kotlinx.serialization ·
commonmark-java

## How it works

The app is a client of the web app's API, so it holds no provider keys:

- `POST /api/chat` with `Accept: text/event-stream` streams `sources`, then `text` pieces, then `done` with
  the full answer and the server-trimmed history to send with the next question, or `error` with a
  safe `detail`.
- `POST /api/chat/compact` condenses a chat's earlier turns into a `summary`, sent with later questions,
  once the history nears the server's 20-turn or 16,000-character limit.

The server enforces the rate limits, per client and for all users together each day, and the app shows
its messages on the failed answer.

It keeps the web app's behaviour and look:

- **Design:** the palette, type and motion of `styles.css`, in light and dark, drawn with Compose
  foundation rather than Material components.
- **Welcome:** the tagline's words rise in over drifting glows, and the composer follows them.
- **Answers:** CommonMark without raw HTML. While an answer is on its way, a label says whether the books
  are being searched or read. It can be stopped, and a failed one asked again.
- **References:** cards under each answer list the passages it cites. A card or a `[1]` chip opens only
  that passage, beside the chat on wide screens and over it on phones.
- **Composer:** Enter sends and Shift+Enter adds a line. Questions stop at 4,000 characters, with a
  counter from 3,500.
- **Session:** like the web app's tab session, a conversation survives rotation and the system ending the
  process in the background. A fresh launch starts a new one.

## Build

Requirements: JDK 17+ and the Android SDK (compileSdk 37); the Gradle wrapper fetches everything else.

```sh
./gradlew testDebugUnitTest assembleDebug
```

The debug APK is in `app/build/outputs/apk/debug/`. Builds talk to the production server at
<https://homeoremedica-619837289655.asia-south1.run.app>. To use a local server from the emulator, start
the web app with `npm start` and pass its address:

```sh
./gradlew installDebug -Phomeoremedica.apiBaseUrl=http://10.0.2.2:8000
```

Debug builds allow plain HTTP to `10.0.2.2` and `localhost` only; release builds require HTTPS.

- `app/src/main/java/.../api/`: the API contracts and the streaming client.
- `app/src/main/java/.../answer/`: citation linking and Markdown parsing.
- `app/src/main/java/.../chat/`: the chat view model and conversation store.
- `app/src/main/java/.../ui/`: the design system and screens.

## Releases

[release-please](https://github.com/googleapis/release-please) opens a release pull request from the
Conventional Commits on `main`. It keeps the version in `version.txt`, which the build reads for
`versionName`.

[Gradle Play Publisher](https://github.com/Triple-T/gradle-play-publisher) uploads to Google Play. It sets
`versionCode` to one more than the highest on Play, so upload with it rather than by hand. It needs:

- `keystore.properties` with the Play upload key (copy `keystore.properties.example`).
- A service account with release access to the app, its JSON key named by `homeoremedica.playCredentials`
  in `~/.gradle/gradle.properties` or held in `ANDROID_PUBLISHER_CREDENTIALS`.

```sh
./gradlew publishBundle                # to internal testing
./gradlew publishListing               # store listing in app/src/main/play
```
