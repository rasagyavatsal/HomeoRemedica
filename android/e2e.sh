#!/bin/sh
# Runs the end-to-end tests in app/src/androidTest (`make e2e`) on the device adb sees, against the web app's
# e2e server, which scripts the answers, and the Firebase emulators, which hold the accounts. It starts them
# on this machine unless they are already running, and stops what it started when the tests end. The device
# reaches them through `adb reverse`, so a remote emulator works too.
#
# Arguments go to Gradle, for example a single class:
#     ./e2e.sh -Pandroid.testInstrumentationRunnerArguments.class=io.github.rasagyavatsal.homeoremedica.ChatTest
set -eu
cd "$(dirname "$0")"
logs=build/e2e
mkdir -p "$logs"

# Each job gets its own process group, so stopping it stops the processes it started too.
set -m
jobs=
stop() {
  for job in $jobs; do kill -INT -- "-$job" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop EXIT
trap 'exit 130' INT TERM

up() { curl -fs -o /dev/null "$1"; }

await() {
  tries=0
  until up "$1"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 180 ]; then echo "$2 did not start; see $logs/." >&2; exit 1; fi
    sleep 1
  done
}

if ! up http://127.0.0.1:9099/; then
  echo "Starting the Firebase emulators"
  # The Firestore emulator needs Java.
  (cd .. && exec npx --yes firebase-tools@15.32.1 emulators:start --config e2e/firebase.json \
    --project demo-homeoremedica --only auth,firestore) >"$logs/emulators.log" 2>&1 &
  jobs="$jobs $!"
  await http://127.0.0.1:9099/ "The Firebase Auth emulator"
  await http://127.0.0.1:8086/ "The Firestore emulator"
fi

if ! up http://127.0.0.1:8100/api/health; then
  echo "Starting the e2e server"
  (cd .. && npx vite build && exec node e2e/server.ts) >"$logs/server.log" 2>&1 &
  jobs="$jobs $!"
  await http://127.0.0.1:8100/api/health "The e2e server"
fi

for port in 8100 9099; do adb reverse "tcp:$port" "tcp:$port" >/dev/null; done
./gradlew connectedDebugAndroidTest -Phomeoremedica.e2e "$@"
