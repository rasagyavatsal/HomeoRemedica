import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { type AppDependencies, type ChatHandler, createApp, productionDependencies } from '../src/server/app.ts'
import { BOOKS, CorpusError } from '../src/server/qdrant.ts'
import { RateLimiter } from '../src/server/rate-limit.ts'
import type { Settings } from '../src/server/runtime.ts'
import type {
  BookSummary,
  Cancellable,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  CompactRequest,
  CompactResponse,
  QuestionKind,
} from '../src/server/contracts.ts'
import { ConfigurationError, ProviderError, ProviderTimeoutError, TokenExhaustionError } from '../src/server/errors.ts'

const BOOK: BookSummary = { bookId: 'kent_lectures', title: "Kent's Lectures", author: 'Kent' }
const INTERNAL = 'Something went wrong while preparing the answer. Please try again.'

class StubService implements ChatHandler {
  readonly requests: ChatRequest[] = []
  readonly compactions: CompactRequest[] = []
  failure: unknown = null
  answer = 'Historical reference only. Kent describes irritability [1].'
  /** What `chat` condensed the request's context into, if it did. */
  compacted: CompactResponse | undefined

  async chat(request: ChatRequest, { onSources, onText }: ChatOptions = {}): Promise<ChatResponse> {
    this.requests.push(request)
    if (this.failure !== null) throw this.failure
    const response: ChatResponse = {
      answer: this.answer,
      corpusVersion: 'local-v1',
      model: 'test-model',
      sources: [
        {
          id: 'local-v1/kent_lectures/chunk-1',
          bookId: BOOK.bookId,
          bookTitle: BOOK.title,
          author: BOOK.author,
          remedyName: 'NUX VOMICA',
          sectionTitle: 'MIND',
          passageIndexes: [1],
          text: 'A passage.',
        },
      ],
      ...(this.compacted && { compacted: this.compacted }),
    }
    onSources?.(response.sources)
    for (const word of this.answer.split(/(?<= )/)) onText?.(word)
    return response
  }

  /** The signals the reading calls were given, to stop them by. */
  readonly signals: (AbortSignal | undefined)[] = []

  async kind(_request: ChatRequest, { signal }: Cancellable = {}): Promise<QuestionKind> {
    this.signals.push(signal)
    if (this.failure !== null) throw this.failure
    return 'case'
  }

  async symptoms(_request: ChatRequest, { signal }: Cancellable = {}): Promise<string[]> {
    this.signals.push(signal)
    if (this.failure !== null) throw this.failure
    return ['Mind: weeping']
  }

  async compact(request: CompactRequest): Promise<CompactResponse> {
    this.compactions.push(request)
    if (this.failure !== null) throw this.failure
    return { summary: 'The user asked about Nux vomica.', history: request.history.slice(-2) }
  }
}

const unexpected = (message: string) => () => {
  throw new Error(message)
}

function setup(
  overrides: Partial<AppDependencies> = {},
  rateLimiter: RateLimiter | null = null,
  totalRateLimiter: RateLimiter | null = null,
) {
  const service = new StubService()
  const app = createApp(
    {
      getService: async () => service,
      ...overrides,
    },
    {
      webDist: null,
      rateLimiter,
      totalRateLimiter,
      kindRateLimiter: null,
      totalKindRateLimiter: null,
      symptomRateLimiter: null,
      totalSymptomRateLimiter: null,
    },
  )
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  const postStream = (body: unknown) => post(body, { Accept: 'text/event-stream' })
  return { app, service, post, postStream }
}

/** Parse a server-sent event stream into `[event, data]` pairs. */
async function events(response: Response): Promise<[string, any][]> {
  return (await response.text())
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const field = (name: string) => block.match(new RegExp(`^${name}: ?(.*)$`, 'm'))?.[1] ?? ''
      return [field('event'), JSON.parse(field('data'))]
    })
}

// Response bodies are JSON shapes the assertions inspect directly.
const read = (response: Response): Promise<any> => response.json()

function quiet() {
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

it('says whether a question describes a case before it is answered', async () => {
  const { app, service } = setup()
  const kind = (body: unknown) =>
    app.request('/api/kind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const response = await kind({ message: 'A weepy, thirstless woman.' })

  expect(response.status).toBe(200)
  expect(await read(response)).toEqual({ kind: 'case' })
  expect((await kind({ message: ' ' })).status).toBe(422)
  expect(service.requests).toEqual([])

  quiet()
  service.failure = new ProviderError('down')
  expect((await kind({ message: 'A weepy woman.' })).status).toBe(502)
})

it('reads the symptoms of a case before it is answered', async () => {
  const { app, service } = setup()
  const symptoms = (body: unknown) =>
    app.request('/api/symptoms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const response = await symptoms({ message: 'A weepy, thirstless woman.' })

  expect(response.status).toBe(200)
  expect(await read(response)).toEqual({ symptoms: ['Mind: weeping'] })
  expect((await symptoms({ message: ' ' })).status).toBe(422)
  expect(service.requests).toEqual([])

  quiet()
  service.failure = new ProviderError('down')
  expect((await symptoms({ message: 'A weepy woman.' })).status).toBe(502)
})

it('stops reading a question when its request is given up', async () => {
  const { app, service } = setup()
  const stop = new AbortController()

  for (const path of ['/api/kind', '/api/symptoms']) {
    await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'A weepy woman.' }),
      signal: stop.signal,
    })
  }
  stop.abort()

  expect(service.signals).toHaveLength(2)
  expect(service.signals.every((signal) => signal?.aborted)).toBe(true)
})

it('takes the symptoms a user confirmed with a question', async () => {
  const { service, post } = setup()

  expect((await post({ message: 'A weepy woman.', symptoms: [' Mind: weeping ', 'Stomach: thirstless'] })).status).toBe(200)
  expect(service.requests[0]?.symptoms).toEqual(['Mind: weeping', 'Stomach: thirstless'])

  expect((await post({ message: 'A weepy woman.', symptoms: [' '] })).status).toBe(422)
  expect((await post({ message: 'A weepy woman.', symptoms: Array.from({ length: 16 }, () => 'Mind: weeping') })).status).toBe(422)
  expect((await post({ message: 'A weepy woman.', symptoms: ['x'.repeat(201)] })).status).toBe(422)
})

it('health needs neither corpus nor provider configuration', async () => {
  const { app } = setup({ getService: unexpected('health must not initialize chat') })

  const response = await app.request('/api/health')

  expect(response.status).toBe(200)
  expect(await read(response)).toEqual({ status: 'ok' })
})

it('books uses only the local catalog', async () => {
  const { app } = setup({ getService: unexpected('listing books must not construct chat providers') })

  const response = await app.request('/api/books')

  expect(response.status).toBe(200)
  expect(await read(response)).toEqual({ books: BOOKS })
})

it('forwards history and returns citations', async () => {
  const { service, post } = setup()
  const history = [
    { role: 'user', content: 'First question?' },
    { role: 'assistant', content: 'First answer.' },
  ]

  const response = await post({ message: '  What about irritability?  ', history })

  expect(response.status).toBe(200)
  expect(service.requests).toHaveLength(1)
  const [request] = service.requests
  expect(request).toEqual({ message: 'What about irritability?', history })
  expect(await read(response)).toEqual({
    answer: service.answer,
    corpusVersion: 'local-v1',
    model: 'test-model',
    history: [...history, { role: 'user', content: 'What about irritability?' }, { role: 'assistant', content: service.answer }],
    sources: [
      {
        id: 'local-v1/kent_lectures/chunk-1',
        bookId: BOOK.bookId,
        bookTitle: BOOK.title,
        author: BOOK.author,
        remedyName: 'NUX VOMICA',
        sectionTitle: 'MIND',
        passageIndexes: [1],
        text: 'A passage.',
      },
    ],
  })
})

describe('streamed chat', () => {
  it('sends sources, answer text, then the completed response', async () => {
    const { service, postStream } = setup()
    service.answer = 'Kent describes irritability [1].'

    const response = await postStream({ message: 'What about irritability?' })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    const received = await events(response)
    expect(received.map(([event]) => event)).toEqual(['sources', 'text', 'text', 'text', 'text', 'done'])
    expect(received[0]![1][0].id).toBe('local-v1/kent_lectures/chunk-1')
    expect(received.slice(1, -1).map(([, data]) => data.text).join('')).toBe(service.answer)
    const done = received.at(-1)![1]
    expect(done.answer).toBe(service.answer)
    expect(done.history).toEqual([
      { role: 'user', content: 'What about irritability?' },
      { role: 'assistant', content: service.answer },
    ])
  })

  it('reports chat failures as an error event without details', async () => {
    quiet()
    const { service, postStream } = setup()
    service.failure = new ProviderTimeoutError('private-secret')

    const response = await postStream({ message: 'question' })

    const text = await response.clone().text()
    expect(await events(response)).toEqual([['error', { detail: 'The request took too long. Please try again.' }]])
    expect(text).not.toContain('private-secret')
  })

  it('reports unexpected errors as an internal error event', async () => {
    quiet()
    const { service, postStream } = setup()
    service.failure = new TypeError('private-secret')

    expect(await events(await postStream({ message: 'question' }))).toEqual([['error', { detail: INTERNAL }]])
  })

  it('rejects invalid requests with JSON before streaming', async () => {
    const { service, postStream } = setup()

    const response = await postStream({ message: '  ' })

    expect(response.status).toBe(422)
    expect(typeof (await read(response)).detail).toBe('string')
    expect(service.requests).toEqual([])
  })
})

it('starts a new conversation with an empty history', async () => {
  const { service, post } = setup()

  const first = await post({ message: 'First question?' })
  const second = await post({ message: 'After clearing?', history: [] })

  expect([first.status, second.status]).toEqual([200, 200])
  expect(service.requests.map((request) => request.history)).toEqual([[], []])
  expect((await read(second)).history[0].content).toBe('After clearing?')
})

it('retains the latest twenty history turns', async () => {
  const { service, post } = setup()
  const history = Array.from({ length: 20 }, (_, number) => ({
    role: number % 2 === 0 ? 'user' : 'assistant',
    content: `old ${number}`,
  }))

  const response = await post({ message: 'New question?', history })

  expect(response.status).toBe(200)
  const retained = (await read(response)).history
  expect(retained).toHaveLength(20)
  expect(retained.slice(0, 18)).toEqual(history.slice(2))
  expect(retained.slice(-2)).toEqual([
    { role: 'user', content: 'New question?' },
    { role: 'assistant', content: service.answer },
  ])
})

it('limits history characters and truncates the answer only in history', async () => {
  const { service, post } = setup()
  const history = [...'abcd'].map((character) => ({ role: 'user', content: character.repeat(4_000) }))
  service.answer = 'answer '.repeat(700)

  const response = await post({ message: 'New question?', history })

  expect(response.status).toBe(200)
  const body = await read(response)
  expect(body.answer).toBe(service.answer)
  expect(body.history).toEqual([
    ...history.slice(2),
    { role: 'user', content: 'New question?' },
    { role: 'assistant', content: service.answer.slice(0, 4_000).trim() },
  ])
  expect(body.history.reduce((total: number, turn: { content: string }) => total + turn.content.length, 0)).toBeLessThanOrEqual(16_000)
})

it('counts a compacted chat’s summary against the history limit', async () => {
  const { service, post } = setup()
  const history = [...'abc'].map((character) => ({ role: 'user', content: character.repeat(4_000) }))
  const summary = 's'.repeat(3_990)

  const response = await post({ message: 'New question?', history, summary })

  expect(response.status).toBe(200)
  expect(service.requests[0]?.summary).toBe(summary)
  // Without the summary the new exchange would fit beside all three turns.
  expect((await read(response)).history).toEqual([
    ...history.slice(1),
    { role: 'user', content: 'New question?' },
    { role: 'assistant', content: service.answer },
  ])
})

describe('compaction', () => {
  const history = [
    { role: 'user' as const, content: 'Tell me about Nux vomica.' },
    { role: 'assistant' as const, content: 'Nux vomica suits irritable patients [1].' },
    { role: 'user' as const, content: 'What about Sepia?' },
    { role: 'assistant' as const, content: 'Sepia is indifferent to loved ones [2].' },
  ]

  it('answers a condensed chat with its new summary and the history after it', async () => {
    const { service, post } = setup()
    service.compacted = { summary: 'The user asked about Nux vomica.', history: history.slice(2) }

    const body = await read(await post({ message: 'New question?', history, summary: 'Earlier summary.' }))

    expect(body.summary).toBe('The user asked about Nux vomica.')
    expect(body.history).toEqual([
      ...history.slice(2),
      { role: 'user', content: 'New question?' },
      { role: 'assistant', content: service.answer },
    ])
    expect(body).not.toHaveProperty('compacted')
  })

  it('answers any other chat with the summary it came with', async () => {
    const { post } = setup()

    expect((await read(await post({ message: 'New question?', history, summary: 'Earlier summary.' }))).summary).toBe('Earlier summary.')
    expect(await read(await post({ message: 'New question?', history }))).not.toHaveProperty('summary')
  })
  const compact = (app: ReturnType<typeof setup>['app'], body: unknown, headers: Record<string, string> = {}) =>
    app.request('/api/chat/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('returns the summary and the history to keep', async () => {
    const { app, service } = setup()

    const response = await compact(app, { history, summary: 'Earlier summary.' })

    expect(response.status).toBe(200)
    expect(service.compactions).toEqual([{ history, summary: 'Earlier summary.' }])
    expect(await read(response)).toEqual({ summary: 'The user asked about Nux vomica.', history: history.slice(2) })
  })

  it.each([
    { history: history.slice(2) },
    { history: [] },
    { history, summary: '  ' },
    { history, unexpected: 'field' },
  ])('rejects %j', async (payload) => {
    const { app, service } = setup()

    const response = await compact(app, payload)

    expect(response.status).toBe(422)
    expect(service.compactions).toEqual([])
  })

  it('has friendly failure details', async () => {
    quiet()
    const { app, service } = setup()
    service.failure = new ProviderTimeoutError('private-secret')

    const response = await compact(app, { history })

    expect(response.status).toBe(504)
    expect(await read(response)).toEqual({ detail: 'The request took too long. Please try again.' })
  })

  it('counts as a question against the rate limit', async () => {
    const { app, post } = setup({}, new RateLimiter([{ limit: 1, windowMs: 60_000 }]))

    expect((await post({ message: 'question' })).status).toBe(200)
    const limited = await compact(app, { history })

    expect(limited.status).toBe(429)
    expect((await read(limited)).detail).toMatch(/Too many questions/)
  })
})

describe('invalid requests are rejected before chat', () => {
  it.each([
    { message: '  ' },
    { message: 'a'.repeat(4_001) },
    { message: 42 },
    {},
    { message: 'question', bookIds: [BOOK.bookId] },
    { message: 'question', history: [{ role: 'system', content: 'hidden' }] },
    { message: 'question', history: Array(21).fill({ role: 'user', content: 'a' }) },
    { message: 'question', history: Array(5).fill({ role: 'user', content: 'a'.repeat(4_000) }) },
    { message: 'question', unexpected: 'field' },
    [],
  ])('%j', async (payload) => {
    const { service, post } = setup()

    const response = await post(payload)

    expect(response.status).toBe(422)
    expect(typeof (await read(response)).detail).toBe('string')
    expect(service.requests).toEqual([])
  })

  it('rejects malformed JSON', async () => {
    const { app } = setup()

    const response = await app.request('/api/chat', { method: 'POST', body: '{"message":' })

    expect(response.status).toBe(422)
  })

  it('does not echo the rejected input', async () => {
    const { post } = setup()

    const response = await post({ message: 'question', history: [{ role: 'system', content: 'private-secret' }] })

    expect(await response.text()).not.toContain('private-secret')
  })
})

it.each<[Error, number, string]>([
  [new ProviderTimeoutError('private-secret'), 504, 'The request took too long. Please try again.'],
  [new DOMException('private-secret', 'TimeoutError'), 504, 'The request took too long. Please try again.'],
  [new ProviderError('private-secret'), 502, 'The chat provider is temporarily unavailable. Please try again shortly.'],
  [new TokenExhaustionError(), 502, 'Response limit reached. Please try again.'],
  [new CorpusError('private-secret'), 500, INTERNAL],
])('%s failures have friendly details', async (failure, status, detail) => {
  quiet()
  const { service, post } = setup()
  service.failure = failure

  const response = await post({ message: 'question' })

  expect(response.status).toBe(status)
  expect(await read(response)).toEqual({ detail })
})

it.each([new Error('private-secret'), new RangeError('private-secret')])(
  'unexpected chat errors do not leak details (%s)',
  async (failure) => {
    quiet()
    const { service, post } = setup()
    service.failure = failure

    const response = await post({ message: 'question' })

    expect(response.status).toBe(500)
    expect(await read(response)).toEqual({ detail: INTERNAL })
  },
)

it('unavailable corpus has a safe, actionable detail', async () => {
  const { post } = setup({
    getService: async () => {
      throw new CorpusError('could not reach Qdrant at /private/secret/path')
    },
  })

  const response = await post({ message: 'question' })

  expect(response.status).toBe(503)
  const { detail } = await read(response)
  expect(detail.toLowerCase()).toContain('corpus')
  expect(detail).toContain('QDRANT_URL')
  expect(detail).not.toContain('/private/secret/path')
})

it('missing provider configuration has a safe setup detail', async () => {
  const { post } = setup({
    getService: async () => {
      throw new ConfigurationError('ZAI_API_KEY is required; private-secret')
    },
  })

  const response = await post({ message: 'question' })

  expect(response.status).toBe(503)
  const { detail } = await read(response)
  expect(detail).toContain('ZAI_API_KEY')
  expect(detail).not.toContain('private-secret')
})

it('unexpected setup errors do not leak details', async () => {
  quiet()
  const { post } = setup({
    getService: async () => {
      throw new TypeError('private-secret')
    },
  })

  const response = await post({ message: 'question' })

  expect(response.status).toBe(500)
  expect(await read(response)).toEqual({ detail: INTERNAL })
})

it('rate-limits chat by the address Cloud Run appends', async () => {
  const { service, post } = setup({}, new RateLimiter([{ limit: 1, windowMs: 60_000 }]))
  const from = (forwardedFor: string) => post({ message: 'question' }, { 'X-Forwarded-For': forwardedFor })

  expect((await from('203.0.113.1')).status).toBe(200)
  const limited = await from('198.51.100.9, 203.0.113.1')
  expect((await from('203.0.113.2')).status).toBe(200)

  expect(limited.status).toBe(429)
  expect(limited.headers.get('Retry-After')).toBe('60')
  expect((await read(limited)).detail).toMatch(/Too many questions/)
  expect(service.requests).toHaveLength(2)
})

it('rate-limits an IPv6 client by its /64', async () => {
  const { post } = setup({}, new RateLimiter([{ limit: 1, windowMs: 60_000 }]))
  const from = (forwardedFor: string) => post({ message: 'question' }, { 'X-Forwarded-For': forwardedFor })

  expect((await from('2001:db8:1:2::1')).status).toBe(200)
  expect((await from('2001:db8:1:2:ffff::9')).status).toBe(429)
  expect((await from('2001:db8:1:3::1')).status).toBe(200)
})

it('caps chat across all clients without counting a client over its own limit', async () => {
  const { service, post } = setup(
    {},
    new RateLimiter([{ limit: 1, windowMs: 60_000 }]),
    new RateLimiter([{ limit: 2, windowMs: 60 * 60_000 }]),
  )
  const from = (forwardedFor: string) => post({ message: 'question' }, { 'X-Forwarded-For': forwardedFor })

  expect((await from('203.0.113.1')).status).toBe(200)
  expect((await from('203.0.113.1')).status).toBe(429)
  expect((await from('203.0.113.2')).status).toBe(200)
  const limited = await from('203.0.113.3')

  expect(limited.status).toBe(429)
  expect(limited.headers.get('Retry-After')).toBe('3600')
  expect((await read(limited)).detail).toMatch(/try again later/)
  expect(service.requests).toHaveLength(2)
})

it('returns JSON 404s for unknown API routes', async () => {
  const { app } = setup()

  const response = await app.request('/api/missing')

  expect(response.status).toBe(404)
  expect(await read(response)).toEqual({ detail: 'Not Found' })
})

describe('production dependencies', () => {
  const settings: Settings = {
    qdrantUrl: 'https://qdrant.example',
    qdrantApiKey: undefined,
    model: 'catalog-model',
    maxOutputTokens: 4_096,
    zaiApiKey: undefined,
    openrouterApiKey: undefined,
    firebaseProjectId: undefined,
    firebaseApiKey: undefined,
    firebaseAuthDomain: undefined,
  }

  it('builds the service once, even for concurrent requests', async () => {
    const stub = new StubService()
    const build = vi.fn(async () => stub)
    const dependencies = productionDependencies({ settings: () => settings, build })

    const services = await Promise.all([dependencies.getService(), dependencies.getService()])

    expect(services).toEqual([stub, stub])
    expect(await dependencies.getService()).toBe(stub)
    expect(build).toHaveBeenCalledExactlyOnceWith(settings)
  })

  it('retries a failed service build on the next request', async () => {
    const stub = new StubService()
    const build = vi.fn<() => Promise<ChatHandler>>().mockRejectedValueOnce(new CorpusError('down')).mockResolvedValue(stub)
    const dependencies = productionDependencies({ settings: () => settings, build })

    await expect(dependencies.getService()).rejects.toThrow(CorpusError)
    expect(await dependencies.getService()).toBe(stub)
    expect(build).toHaveBeenCalledTimes(2)
  })
})

describe('web app', () => {
  it('serves its page at the legal paths', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'homeoremedica-web-'))
    try {
      writeFileSync(join(webDist, 'index.html'), '<div id="root"></div>')
      const app = createApp({ getService: async () => new StubService() }, { webDist, rateLimiter: null })

      for (const path of ['/privacy', '/terms']) {
        const response = await app.request(path)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe('<div id="root"></div>')
      }
      expect((await app.request('/elsewhere')).status).toBe(404)
    } finally {
      rmSync(webDist, { recursive: true, force: true })
    }
  })

  it('keeps built assets for a year and checks the page on every visit', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'homeoremedica-web-'))
    try {
      writeFileSync(join(webDist, 'index.html'), '<div id="root"></div>')
      mkdirSync(join(webDist, 'assets'))
      writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'console.log(1)')
      const app = createApp({ getService: async () => new StubService() }, { webDist, rateLimiter: null })

      const asset = await app.request('/assets/index-abc123.js')
      expect(asset.status).toBe(200)
      expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
      for (const path of ['/', '/index.html', '/privacy']) {
        expect((await app.request(path)).headers.get('Cache-Control')).toBe('no-cache')
      }
    } finally {
      rmSync(webDist, { recursive: true, force: true })
    }
  })
})
