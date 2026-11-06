# HomeoRemedica for Android

A native Android client for [HomeoRemedica](https://github.com/rasagyavatsal/HomeoRemedica), the
retrieval-augmented chat over historical homoeopathic materia medica. It asks the same questions of the
same seven books and shows the same cited answers as the web app. Historical reference only; not medical
advice.

**Stack:** Kotlin · Jetpack Compose (foundation only, no Material) · OkHttp · kotlinx.serialization ·
commonmark-java · Firebase Authentication · Credential Manager

## How it works

The app is a client of the web app's API, so it holds no provider keys:

- `POST /api/chat` with `Accept: text/event-stream` streams `sources`, then `text` pieces, then `done` with
  the full answer and the server-trimmed history to send with the next question, or `error` with a
  safe `detail`.
- `POST /api/chat/compact` condenses a chat's earlier turns into a `summary`, sent with later questions,
  once the history nears the server's 20-turn or 16,000-character limit.

Signed in, the saved-chat endpoints take a Firebase ID token as `Authorization: Bearer <token>`:
`GET /api/chats`, `GET`, `PUT` and `DELETE /api/chats/:id`, `GET /api/chats/:id/feedback`,
`PUT /api/feedback/:id` for one answer's ratings, and `DELETE /api/account`. Saving and rating need a
verified email address.

The server enforces the rate limits, per client and for all users together each day, and the app shows
its messages on the failed answer.

It keeps the web app's behaviour and look:

- **Design:** the design tokens of `tokens.css` and the potency drop logo, drawn with Compose foundation
  rather than Material components. A toggle steps through the system, light and dark themes.
- **Welcome:** the tagline's words rise in over drifting glows, and the composer follows them.
- **Answers:** CommonMark without raw HTML. While an answer is on its way, a label says whether the books
  are being searched or read. It can be stopped, and a failed one asked again.
- **References:** cards under each answer list the passages it cites. A card or a `[1]` chip opens only
  that passage, beside the chat on wide screens and over it on phones.
- **Composer:** Enter sends and Shift+Enter adds a line. Questions stop at 4,000 characters, with a
  counter from 3,500.
- **Chats:** up to 50 are saved on the device, and the app reopens the last one. The chats drawer starts
  a new chat, searches them from six on, groups them by age and deletes them. It sits beside the chat on
  wide screens and slides over it on phones.
- **Practitioners:** a notice on first launch says who the app is for. The account menu links the Privacy
  Policy and Terms of Use and shows the version.
- **Accounts:** sign in with email or Google, create an account, or have a password-reset link sent. Email
  sign-ups are sent a verification link, which the menu can send again; the app checks for it each time
  it comes back. Once the email is verified, the device's chats move into the account and chats sync
  through it. The menu signs out and deletes the account with its chats.
- **Ratings:** signed in with a verified email, answers can be rated up or down. Rating one opens a box
  for a comment, with reasons to pick for an answer rated down. A passage can be rated from its panel.

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

Accounts need the web app's Firebase project. Without `app/google-services.json` the app builds without
them and keeps chats on the device, as the web app does when its server has no accounts. To turn them on:

1. Add an Android app with the package `com.rasagyavatsal.homeoremedica` to the Firebase project, with
   the SHA-1 fingerprints of the debug key, the upload key and Play's app signing key, so Google sign-in
   accepts the builds.
2. Download its `google-services.json` into `app/`.

- `app/src/main/java/.../account/`: Firebase sign-in and the account view model.
- `app/src/main/java/.../api/`: the API contracts and the streaming client.
- `app/src/main/java/.../answer/`: citation linking and Markdown parsing.
- `app/src/main/java/.../chat/`: the chat view model, the saved chats on the device or the account, and
  ratings.
- `app/src/main/java/.../ui/`: the design system and screens.

## Commands

`make` in this directory lists shortcuts for the device adb sees: `make run` installs and opens the app,
`make local` does the same with a build that uses `npm start` on this machine, and `make emu`, `make logs`,
`make shot` and `make test` open the screen with [scrcpy](https://github.com/Genymobile/scrcpy), follow the
app's log, save a screenshot and run the unit tests.

### End-to-end tests

`make e2e` runs the tests in `app/src/androidTest` on the device adb sees, and `make e2e TEST=ChatTest`
runs one class. They drive the app with Compose UI tests against the web app's e2e server (`e2e/server.ts`),
which scripts the answers, and the Firebase Auth and Firestore emulators, which hold the accounts. `e2e.sh`
starts them on this machine unless they are running, which needs Node, the web app's `npm install` and Java,
and the device reaches them through `adb reverse`. The tests build the app with `-Phomeoremedica.e2e`, which
points it at both and asks from an address of its own each launch, as the server limits questions per address.

Each test starts from a fresh install. Robots in `robots/` are the only code that knows how the screens
are built; tests say what the reader does and sees.

### Remote emulator

The emulator can run on another Linux machine on the network:

1. On that machine, install the Android SDK and create an emulator. Add a systemd user service named
   `android-emulator` that runs `emulator -avd <name> -no-window -ports 5554,5555`, and turn on lingering
   for the user (`loginctl enable-linger`) so it can run without a login.
2. Copy this machine's `~/.android/adbkey` and `adbkey.pub` to that machine's `~/.android/` before the
   emulator's first boot. Play Store images trust only the key of the machine that runs them.
3. Here, put its SSH address in `local.mk`:

   ```make
   EMULATOR_HOST = user@192.168.1.20
   ```

The make commands then start the emulator if it's stopped, tunnel adb to it over SSH, and tunnel port 8000
back, so `10.0.2.2:8000` in the emulator still reaches `npm start` here. Closing the window `make emu` opens
stops the emulator, and so does `make stop`; `make disconnect` closes the tunnel and leaves it running.

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

Each `android-v*` release runs `./gradlew test publishBundle` in the `Deploy` GitHub Actions workflow,
which you can also run by hand with `android`. It reads the upload key from the repository secrets
`ANDROID_KEYSTORE_BASE64` (the `.jks`, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`
and `ANDROID_KEY_PASSWORD`, and the service account's JSON key from `PLAY_SERVICE_ACCOUNT_JSON`.
