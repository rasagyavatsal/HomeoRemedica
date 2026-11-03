/**
 * The app as the end-to-end tests drive it: the built frontend and the real API, with scripted
 * answers in place of the providers and accounts in the Firebase emulators.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import { serve } from '@hono/node-server'

import { firebaseAccounts } from '../src/server/accounts.ts'
import { type ChatHandler, createApp } from '../src/server/app.ts'
import type { ChatOptions, ChatRequest, ChatResponse } from '../src/server/contracts.ts'
import { ChatFailure } from '../src/server/errors.ts'
import { RateLimiter } from '../src/server/rate-limit.ts'
import {
  API_KEY,
  AUTH_EMULATOR,
  CHAT_LIMIT,
  E2E_PORT,
  FAIL_ONCE,
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  SLOW,
  SOURCES,
  answerTo,
} from './scenario.ts'

// firebase-admin reads these to talk to the emulators instead of Google.
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= AUTH_EMULATOR
process.env.FIRESTORE_EMULATOR_HOST ??= FIRESTORE_EMULATOR

/** Answers from `scenario.ts`, streamed a word at a time like the providers'. */
class ScriptedChat implements ChatHandler {
  readonly #failed = new Set<string>()

  async chat({ message, history }: ChatRequest, { onSources, onText, signal }: ChatOptions = {}): Promise<ChatResponse> {
    await sleep(50, undefined, { signal })
    if (message.includes(FAIL_ONCE) && !this.#failed.has(message)) {
      this.#failed.add(message)
      throw new ChatFailure({ stage: 'answer_generation', kind: 'timeout' })
    }
    onSources?.(SOURCES)
    const answer = answerTo(message, history.findLast((turn) => turn.role === 'user')?.content)
    const delay = message.includes(SLOW) ? 100 : 5
    for (const word of answer.split(/(?<= )/)) {
      await sleep(delay, undefined, { signal })
      onText?.(word)
    }
    return { answer, corpusVersion: 'e2e', model: 'scripted', sources: SOURCES }
  }
}

const service = new ScriptedChat()
const accounts = firebaseAccounts({
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  emulator: `http://${AUTH_EMULATOR}`,
})
const app = createApp(
  { getService: async () => service, getAccounts: () => accounts },
  { rateLimiter: new RateLimiter([{ limit: CHAT_LIMIT, windowMs: 60_000 }]), totalRateLimiter: null },
)

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: E2E_PORT }, (info) => {
  console.log(`HomeoRemedica e2e server: http://127.0.0.1:${info.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
