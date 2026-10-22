/** HTTP interface to the production HomeoRemedica chat pipeline. */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { BOOKS, CorpusError } from './qdrant.ts'
import { type Settings, buildService, loadSettings } from './runtime.ts'
import {
  type BookCatalog,
  type ChatOptions,
  type ChatRequest,
  ChatRequestSchema,
  type ChatResponse,
  type WebChatResponse,
} from './contracts.ts'
import { advanceHistory } from './conversation.ts'
import { RateLimiter } from './rate-limit.ts'
import { ChatFailure, ConfigurationError, FAILURE_DETAILS, type FailureKind } from './errors.ts'

export interface ChatHandler {
  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>
}

export interface AppDependencies {
  getCatalog: () => BookCatalog
  getService: () => Promise<ChatHandler>
}

const FAILURE_STATUS: Record<FailureKind, ContentfulStatusCode> = {
  timeout: 504,
  provider: 502,
  token_exhaustion: 502,
  internal: 500,
}

// `npm start` serves the built frontend too. During development Vite serves both.
export const WEB_DIST = fileURLToPath(new URL('../../dist', import.meta.url))

/** Load the catalog and build the chat service once; a failed build is retried on the next request. */
export function productionDependencies({
  settings = loadSettings,
  build = buildService,
}: {
  settings?: () => Settings
  build?: (settings: Settings) => Promise<ChatHandler>
} = {}): AppDependencies {
  let catalog: BookCatalog | undefined
  let service: Promise<ChatHandler> | undefined
  return {
    getCatalog() {
      if (!catalog) {
        const { qdrantCollection, model } = settings()
        catalog = { books: BOOKS, corpusVersion: qdrantCollection, model }
      }
      return catalog
    },
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
  { webDist = WEB_DIST, rateLimiter = new RateLimiter() }: { webDist?: string | null; rateLimiter?: RateLimiter | null } = {},
): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  app.get('/api/books', (c) => {
    try {
      return c.json(dependencies.getCatalog())
    } catch (error) {
      return setupFailure(c, error, 'Failed to load the production book catalog')
    }
  })

  if (rateLimiter) {
    app.post('/api/chat', async (c, next) => {
      const retryAfter = rateLimiter.take(clientAddress(c))
      if (retryAfter === undefined) return next()
      c.header('Retry-After', String(retryAfter))
      return c.json({ detail: 'Too many questions in a short time. Please wait a minute and try again.' }, 429)
    })
  }

  app.post('/api/chat', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ detail: 'request body must be valid JSON' }, 422)
    }
    const parsed = ChatRequestSchema.safeParse(body)
    if (!parsed.success) {
      // Return the useful validation message without echoing a user's history or input.
      return c.json({ detail: parsed.error.issues[0]?.message ?? 'invalid request' }, 422)
    }
    const request = parsed.data

    let service: ChatHandler
    try {
      service = await dependencies.getService()
    } catch (error) {
      return setupFailure(c, error, 'Failed to initialize production chat')
    }

    const complete = (response: ChatResponse): WebChatResponse => ({
      ...response,
      history: advanceHistory(request.history, request.message, response.answer),
    })

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

  app.all('/api/*', (c) => c.json({ detail: 'Not Found' }, 404))

  if (webDist && existsSync(`${webDist}/index.html`)) {
    app.use('/*', serveStatic({ root: webDist }))
  }

  app.onError((error, c) => {
    console.error('Unhandled API error', error)
    return c.json({ detail: FAILURE_DETAILS.internal }, 500)
  })

  return app
}

// Cloud Run appends the connecting address to X-Forwarded-For, so a client cannot forge the last
// entry. Without a proxy in front, every client shares one limit.
function clientAddress(c: Context): string {
  return c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim() || 'direct'
}

function chatFailure(error: unknown): { detail: string; status: ContentfulStatusCode } {
  if (error instanceof ChatFailure) return { detail: FAILURE_DETAILS[error.kind], status: FAILURE_STATUS[error.kind] }
  console.error('Production chat failed', error)
  return { detail: FAILURE_DETAILS.internal, status: 500 }
}

function setupFailure(c: Context, error: unknown, logMessage: string) {
  if (error instanceof CorpusError) {
    return c.json(
      {
        detail:
          'The production corpus is unavailable. Check QDRANT_URL, QDRANT_API_KEY and ' +
          'RAG_QDRANT_COLLECTION, then restart the API.',
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
