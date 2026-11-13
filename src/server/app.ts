/** HTTP interface to the production HomeoRemedica chat pipeline. */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { streamSSE } from 'hono/streaming'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'

import { BOOKS, CorpusError } from './qdrant.ts'
import type { Accounts } from './accounts.ts'
import { type Settings, buildService, loadAccounts, loadSettings } from './runtime.ts'
import {
  type BookCatalog,
  type ChatList,
  type Cancellable,
  type ChatOptions,
  type ChatRequest,
  ChatRequestSchema,
  type ChatResponse,
  type ChatRatings,
  type ChatSummary,
  type ClientConfig,
  type CompactRequest,
  CompactRequestSchema,
  type CompactResponse,
  type DiseasesResponse,
  type KindResponse,
  type QuestionKind,
  type SymptomsResponse,
  answerRatings,
  FeedbackSchema,
  SavedChatSchema,
  type WebChatResponse,
} from './contracts.ts'
import { advanceHistory } from './conversation.ts'
import { CHAT_SAVE_RATE_LIMITS, FEEDBACK_RATE_LIMITS, RateLimiter, TOTAL_CHAT_RATE_LIMITS, clientKey } from './rate-limit.ts'
import {
  ConfigurationError,
  FAILURE_DETAILS,
  type FailureKind,
  ProviderError,
  TokenExhaustionError,
  isTimeout,
} from './errors.ts'

export interface ChatHandler {
  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>
  compact(request: CompactRequest, options?: { signal?: AbortSignal }): Promise<CompactResponse>
  kind(request: ChatRequest, options?: Cancellable): Promise<QuestionKind>
  symptoms(request: ChatRequest, options?: Cancellable): Promise<string[]>
  diseases(request: ChatRequest, options?: Cancellable): Promise<string[]>
}

export interface AppDependencies {
  getService: () => Promise<ChatHandler>
  /** Sign-in and saved chats, or null when this server has no accounts. */
  getAccounts?: () => Accounts | null
}

interface SignedIn {
  Variables: { accounts: Accounts; userId: string; verified: boolean }
}

const FAILURE_STATUS: Record<FailureKind, ContentfulStatusCode> = {
  timeout: 504,
  provider: 502,
  token_exhaustion: 502,
  internal: 500,
}

// `npm start` serves the built frontend too. During development Vite serves both.
export const WEB_DIST = fileURLToPath(new URL('../../dist', import.meta.url))
const LEGAL_PAGES = ['/privacy', '/terms']

const ACCOUNT_FAILURE = 'Your saved chats could not be reached. Please try again.'
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/
// A long chat with every answer's sources fits well within this.
const MAX_SAVED_CHAT_BYTES = 8_000_000
// A question, the longest answer and the ids of its sources.
const MAX_FEEDBACK_BYTES = 64_000

/** Build the chat service once; a failed build is retried on the next request. */
export function productionDependencies({
  settings = loadSettings,
  build = buildService,
}: {
  settings?: () => Settings
  build?: (settings: Settings) => Promise<ChatHandler>
} = {}): AppDependencies {
  let service: Promise<ChatHandler> | undefined
  let accounts: Accounts | null | undefined
  return {
    getAccounts: () => (accounts ??= loadAccounts(settings())),
    getService() {
      // Share one in-flight build between concurrent requests. Conversation state stays in
      // the request and is never shared between browser sessions.
      service ??= Promise.resolve()
        .then(() => build(settings()))
        .catch((error: unknown) => {
          service = undefined
          throw error
        })
      return service
    },
  }
}

export function createApp(
  dependencies: AppDependencies = productionDependencies(),
  {
    webDist = WEB_DIST,
    rateLimiter = new RateLimiter(),
    totalRateLimiter = new RateLimiter(TOTAL_CHAT_RATE_LIMITS),
    kindRateLimiter = new RateLimiter(),
    totalKindRateLimiter = new RateLimiter(TOTAL_CHAT_RATE_LIMITS),
    symptomRateLimiter = new RateLimiter(),
    totalSymptomRateLimiter = new RateLimiter(TOTAL_CHAT_RATE_LIMITS),
    diseaseRateLimiter = new RateLimiter(),
    totalDiseaseRateLimiter = new RateLimiter(TOTAL_CHAT_RATE_LIMITS),
    saveRateLimiter = new RateLimiter(CHAT_SAVE_RATE_LIMITS),
    feedbackRateLimiter = new RateLimiter(FEEDBACK_RATE_LIMITS),
  }: {
    webDist?: string | null
    rateLimiter?: RateLimiter | null
    totalRateLimiter?: RateLimiter | null
    /** Counts the questions each client has had sorted into cases and others, apart from its questions. */
    kindRateLimiter?: RateLimiter | null
    totalKindRateLimiter?: RateLimiter | null
    /** Counts the cases each client has read for symptoms, apart from its questions. */
    symptomRateLimiter?: RateLimiter | null
    totalSymptomRateLimiter?: RateLimiter | null
    /** Counts the cases each client has read for diseases, apart from its questions. */
    diseaseRateLimiter?: RateLimiter | null
    totalDiseaseRateLimiter?: RateLimiter | null
    /** Counts the messages each user saves. */
    saveRateLimiter?: RateLimiter | null
    /** Counts the ratings each user sends. */
    feedbackRateLimiter?: RateLimiter | null
  } = {},
): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  app.get('/api/books', (c) => c.json({ books: BOOKS } satisfies BookCatalog))

  app.get('/api/config', (c) => c.json({ auth: dependencies.getAccounts?.()?.config ?? null } satisfies ClientConfig))

  const signedIn = createMiddleware<SignedIn>(async (c, next) => {
    const accounts = dependencies.getAccounts?.() ?? null
    if (!accounts) return c.json({ detail: 'Accounts are not available on this server.' }, 503)
    const token = c.req.header('Authorization')?.match(/^Bearer (\S+)$/)?.[1]
    const user = token ? await accounts.user(token) : undefined
    if (!user) return c.json({ detail: 'Please sign in again.' }, 401)
    c.set('accounts', accounts)
    c.set('userId', user.id)
    c.set('verified', user.verified)
    await next()
  })

  const chatId = createMiddleware(async (c, next) => {
    if (!CHAT_ID.test(c.req.param('id') ?? '')) return c.json({ detail: 'Chat not found.' }, 404)
    await next()
  })

  app.get('/api/chats', signedIn, async (c) => {
    return c.json({ chats: await c.var.accounts.chats.list(c.var.userId) } satisfies ChatList)
  })

  app.delete('/api/chats', signedIn, async (c) => {
    await c.var.accounts.chats.deleteAll(c.var.userId)
    return c.body(null, 204)
  })

  app.get('/api/chats/:id', signedIn, chatId, async (c) => {
    const chat = await c.var.accounts.chats.get(c.var.userId, c.req.param('id'))
    return chat ? c.json(chat) : c.json({ detail: 'Chat not found.' }, 404)
  })

  app.put(
    '/api/chats/:id',
    signedIn,
    chatId,
    bodyLimit({ maxSize: MAX_SAVED_CHAT_BYTES, onError: (c) => c.json({ detail: 'This chat is too long to save.' }, 413) }),
    async (c) => {
      // Only a verified email can save, so made-up addresses cannot multiply the save limit.
      if (!c.var.verified) return c.json({ detail: 'Verify your email address to save chats to your account.' }, 403)
      const retryAfter = saveRateLimiter?.wait(c.var.userId)
      if (retryAfter !== undefined) {
        c.header('Retry-After', String(retryAfter))
        return c.json({ detail: 'Too many messages saved in a short time. Please try again later.' }, 429)
      }
      const saved = await readBody(c, SavedChatSchema)
      if (saved instanceof Response) return saved
      // A browser clock set in the future would keep a chat at the top of every list.
      const chat = { ...saved, updatedAt: Math.min(saved.updatedAt, Date.now()) }
      const id = c.req.param('id')
      const written = await c.var.accounts.chats.put(c.var.userId, id, chat)
      // A save resends the whole chat, so count only the messages the store had to write.
      saveRateLimiter?.add(c.var.userId, written)
      return c.json({ id, title: chat.title, updatedAt: chat.updatedAt } satisfies ChatSummary)
    },
  )

  app.get('/api/chats/:id/feedback', signedIn, chatId, async (c) => {
    const saved = await c.var.accounts.feedback.list(c.var.userId, c.req.param('id'))
    const ratings = Object.fromEntries([...saved].map(([messageId, feedback]) => [messageId, answerRatings(feedback)]))
    return c.json({ ratings } satisfies ChatRatings)
  })

  app.delete('/api/chats/:id', signedIn, chatId, async (c) => {
    await c.var.accounts.chats.delete(c.var.userId, c.req.param('id'))
    return c.body(null, 204)
  })

  // One document per answer, so rating it again replaces the earlier ratings.
  app.put(
    '/api/feedback/:id',
    signedIn,
    bodyLimit({ maxSize: MAX_FEEDBACK_BYTES, onError: (c) => c.json({ detail: 'This feedback is too long to send.' }, 413) }),
    async (c) => {
      const id = c.req.param('id')
      if (!CHAT_ID.test(id)) return c.json({ detail: 'Not Found' }, 404)
      // As with saving, only a verified email counts, so made-up addresses cannot flood the ratings.
      if (!c.var.verified) return c.json({ detail: 'Verify your email address to rate answers.' }, 403)
      const retryAfter = feedbackRateLimiter?.take(c.var.userId)
      if (retryAfter !== undefined) {
        c.header('Retry-After', String(retryAfter))
        return c.json({ detail: 'Too many ratings in a short time. Please try again later.' }, 429)
      }
      const feedback = await readBody(c, FeedbackSchema)
      if (feedback instanceof Response) return feedback
      await c.var.accounts.feedback.put(c.var.userId, id, feedback)
      return c.body(null, 204)
    },
  )

  // Delete the chats first, so a failure leaves an account the user can still sign in to.
  app.delete('/api/account', signedIn, async (c) => {
    await c.var.accounts.chats.deleteAll(c.var.userId)
    await c.var.accounts.deleteUser(c.var.userId)
    return c.body(null, 204)
  })

  // Check the client first, so a client over its own limit does not use up everyone's. A compaction
  // asked for by itself costs a model call too, so it counts as a question.
  const limited = (client: RateLimiter | null, total: RateLimiter | null) =>
    createMiddleware(async (c, next) => {
      const limits = [
        [client, clientKey(clientAddress(c)), 'Too many questions in a short time. Please wait a minute and try again.'],
        [total, 'all', 'HomeoRemedica has answered all the questions it can for now. Please try again later.'],
      ] as const
      for (const [limiter, key, detail] of limits) {
        const retryAfter = limiter?.take(key)
        if (retryAfter === undefined) continue
        c.header('Retry-After', String(retryAfter))
        return c.json({ detail }, 429)
      }
      await next()
    })
  const questionLimits = limited(rateLimiter, totalRateLimiter)
  app.post('/api/chat', questionLimits)
  app.post('/api/chat/compact', questionLimits)
  // Sorting a question and reading a case for its symptoms and diseases cost a model call each too, but they
  // come before the same question is asked, so each is counted apart and does not take from the
  // questions a client may ask.
  app.post('/api/kind', limited(kindRateLimiter, totalKindRateLimiter))
  app.post('/api/symptoms', limited(symptomRateLimiter, totalSymptomRateLimiter))
  app.post('/api/diseases', limited(diseaseRateLimiter, totalDiseaseRateLimiter))

  /**
   * Answers with what `read` makes of the question, before the question itself is asked. The
   * request's signal stops the model call when the browser gives up on it.
   */
  const beforeAsking = (
    read: (service: ChatHandler, request: ChatRequest, options: Cancellable) => Promise<KindResponse | SymptomsResponse | DiseasesResponse>,
  ) =>
    async (c: Context) => {
      const request = await readBody(c, ChatRequestSchema)
      if (request instanceof Response) return request

      let service: ChatHandler
      try {
        service = await dependencies.getService()
      } catch (error) {
        return setupFailure(c, error, 'Failed to initialize production chat')
      }
      try {
        return c.json(await read(service, request, { signal: c.req.raw.signal }))
      } catch (error) {
        const { detail, status } = chatFailure(error)
        return c.json({ detail }, status)
      }
    }
  app.post('/api/kind', beforeAsking(async (service, request, options) => ({ kind: await service.kind(request, options) })))
  app.post('/api/symptoms', beforeAsking(async (service, request, options) => ({ symptoms: await service.symptoms(request, options) })))
  app.post('/api/diseases', beforeAsking(async (service, request, options) => ({ diseases: await service.diseases(request, options) })))

  app.post('/api/chat', async (c) => {
    const request = await readBody(c, ChatRequestSchema)
    if (request instanceof Response) return request

    let service: ChatHandler
    try {
      service = await dependencies.getService()
    } catch (error) {
      return setupFailure(c, error, 'Failed to initialize production chat')
    }

    const complete = ({ compacted, ...response }: ChatResponse): WebChatResponse => {
      const { history, summary } = compacted ?? request
      return {
        ...response,
        history: advanceHistory(history, request.message, response.answer, summary),
        ...(summary !== undefined && { summary }),
      }
    }

    // Browsers ask for a stream: `sources`, then `text` pieces, then `done` or `error`.
    if (c.req.header('Accept')?.includes('text/event-stream')) {
      return streamSSE(c, async (stream) => {
        const controller = new AbortController()
        stream.onAbort(() => controller.abort())
        let writes = Promise.resolve()
        const send = (event: string, data: unknown) => {
          writes = writes.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
        }
        try {
          const response = await service.chat(request, {
            onSources: (sources) => send('sources', sources),
            onText: (text) => send('text', { text }),
            signal: controller.signal,
          })
          send('done', complete(response))
        } catch (error) {
          send('error', { detail: chatFailure(error).detail })
        }
        // A closed connection rejects the remaining writes; there is no one left to tell.
        await writes.catch(() => {})
      })
    }

    try {
      return c.json(complete(await service.chat(request)))
    } catch (error) {
      const { detail, status } = chatFailure(error)
      return c.json({ detail }, status)
    }
  })

  // Released Android builds compact a chat themselves before asking; newer clients leave it to `/api/chat`.
  app.post('/api/chat/compact', async (c) => {
    const request = await readBody(c, CompactRequestSchema)
    if (request instanceof Response) return request

    let service: ChatHandler
    try {
      service = await dependencies.getService()
    } catch (error) {
      return setupFailure(c, error, 'Failed to initialize production chat')
    }
    try {
      return c.json(await service.compact(request, { signal: c.req.raw.signal }))
    } catch (error) {
      const { detail, status } = chatFailure(error)
      return c.json({ detail }, status)
    }
  })

  app.all('/api/*', (c) => c.json({ detail: 'Not Found' }, 404))

  if (webDist && existsSync(`${webDist}/index.html`)) {
    app.use('/*', webCache)
    // The legal pages are views of the web app, so they serve its page.
    for (const page of LEGAL_PAGES) app.get(page, serveStatic({ root: webDist, path: 'index.html' }))
    app.use('/*', serveStatic({ root: webDist }))
  }

  app.onError((error, c) => {
    console.error('Unhandled API error', error)
    const accountRoute = /^\/api\/(chats|account)(\/|$)/.test(c.req.path)
    return c.json({ detail: accountRoute ? ACCOUNT_FAILURE : FAILURE_DETAILS.internal }, 500)
  })

  return app
}

// Vite names every file under /assets/ after its contents, so a file there never changes and can be
// kept for a year. The page itself names the current files, so it is checked on every visit.
const webCache = createMiddleware(async (c, next) => {
  await next()
  if (!c.res.ok) return
  c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
})

// Cloud Run appends the connecting address to X-Forwarded-For, so a client cannot forge the last
// entry. Without a proxy in front, every client shares one limit.
function clientAddress(c: Context): string {
  return c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim() || 'direct'
}

// Answer with the useful validation message without echoing a user's history or input.
async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S> | Response> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ detail: 'request body must be valid JSON' }, 422)
  }
  const parsed = schema.safeParse(body)
  return parsed.success ? parsed.data : c.json({ detail: parsed.error.issues[0]?.message ?? 'invalid request' }, 422)
}

function chatFailure(error: unknown): { detail: string; status: ContentfulStatusCode } {
  console.error('Production chat failed', error)
  const kind = failureKind(error)
  return { detail: FAILURE_DETAILS[kind], status: FAILURE_STATUS[kind] }
}

// Anything that is not a provider's failure, such as a CorpusError from Qdrant, is internal.
function failureKind(error: unknown): FailureKind {
  if (error instanceof TokenExhaustionError) return 'token_exhaustion'
  if (isTimeout(error)) return 'timeout'
  if (error instanceof ProviderError) return 'provider'
  return 'internal'
}

function setupFailure(c: Context, error: unknown, logMessage: string) {
  if (error instanceof CorpusError) {
    return c.json(
      {
        detail:
          'The production corpus is unavailable. Check QDRANT_URL, QDRANT_API_KEY and the ' +
          'book collections in Qdrant, then restart the API.',
      },
      503,
    )
  }
  if (error instanceof ConfigurationError) {
    return c.json(
      {
        detail:
          'The production chat is not configured. Check OPENROUTER_API_KEY, ZAI_API_KEY, ' +
          'QDRANT_URL and the RAG_ settings in .env, then restart the API.',
      },
      503,
    )
  }
  console.error(logMessage, error)
  return c.json({ detail: FAILURE_DETAILS.internal }, 500)
}
