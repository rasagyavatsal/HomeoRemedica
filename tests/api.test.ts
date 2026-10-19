import { describe, expect, it, vi } from 'vitest'

import { type AppDependencies, type ChatHandler, createApp, productionDependencies } from '../src/server/app.ts'
import { BOOKS, CorpusError } from '../src/server/qdrant.ts'
import type { Settings } from '../src/server/runtime.ts'
import type { BookCatalog, BookSummary, ChatRequest, ChatResponse } from '../src/server/contracts.ts'
import { ChatFailure, ConfigurationError, type FailureKind } from '../src/server/errors.ts'

const BOOK: BookSummary = { bookId: 'kent-lectures', title: "Kent's Lectures", author: 'Kent' }
const INTERNAL = 'Something went wrong while preparing the answer. Please try again.'

class StubService implements ChatHandler {
  readonly requests: ChatRequest[] = []
  failure: unknown = null
  answer = 'Historical reference only. Kent describes irritability [1].'

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request)
    if (this.failure !== null) throw this.failure
    return {
      answer: this.answer,
      corpusVersion: 'local-v1',
      model: 'test-model',
      sources: [
        {
          id: 'local-v1/kent-lectures/chunk-1',
          bookId: BOOK.bookId,
          bookTitle: BOOK.title,
          author: BOOK.author,
          remedyName: 'NUX VOMICA',
          sectionTitle: 'MIND',
          passageIndexes: [1],
          text: 'A passage.',
        },
      ],
    }
  }
}

const unexpected = (message: string) => () => {
  throw new Error(message)
}

function setup(overrides: Partial<AppDependencies> = {}) {
  const service = new StubService()
  const app = createApp(
    {
      getCatalog: () => ({ books: [BOOK], corpusVersion: 'local-v1', model: 'test-model' }),
      getService: async () => service,
      ...overrides,
    },
    { webDist: null },
  )
  const post = (body: unknown) =>
    app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { app, service, post }
}

// Response bodies are JSON shapes the assertions inspect directly.
const read = (response: Response): Promise<any> => response.json()

function quiet() {
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

it('health needs neither corpus nor provider configuration', async () => {
  const { app } = setup({
    getCatalog: unexpected('health must not load the catalog'),
    getService: unexpected('health must not initialize chat'),
  })

  const response = await app.request('/api/health')

  expect(response.status).toBe(200)
  expect(await read(response)).toEqual({ status: 'ok' })
})

it('books uses only the local catalog', async () => {
  const { app } = setup({ getService: unexpected('listing books must not construct chat providers') })

  const response = await app.request('/api/books')

  expect(response.status).toBe(200)
  expect(await read(response)).toEqual({ books: [BOOK], corpusVersion: 'local-v1', model: 'test-model' })
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
        id: 'local-v1/kent-lectures/chunk-1',
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

it.each<[FailureKind, number, string]>([
  ['timeout', 504, 'The request took too long. Please try again.'],
  ['provider', 502, 'The chat provider is temporarily unavailable. Please try again shortly.'],
  ['token_exhaustion', 502, 'Response limit reached. Please try again.'],
  ['internal', 500, INTERNAL],
])('classified %s failures have friendly details', async (kind, status, detail) => {
  const { service, post } = setup()
  service.failure = new ChatFailure({ stage: 'answer_generation', kind, cause: new Error('private-secret') })

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

const request = (app: ReturnType<typeof setup>['app'], endpoint: string) =>
  endpoint === '/api/books'
    ? app.request(endpoint)
    : app.request(endpoint, { method: 'POST', body: JSON.stringify({ message: 'question' }) })

it.each(['/api/books', '/api/chat'])('unavailable corpus has a safe, actionable detail on %s', async (endpoint) => {
  const missingCorpus = () => {
    throw new CorpusError('could not reach Qdrant at /private/secret/path')
  }
  const { app } = setup({ getCatalog: missingCorpus, getService: async () => missingCorpus() })

  const response = await request(app, endpoint)

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

it.each(['/api/books', '/api/chat'])('unexpected setup errors do not leak details on %s', async (endpoint) => {
  quiet()
  const broken = () => {
    throw new TypeError('private-secret')
  }
  const { app } = setup({ getCatalog: broken, getService: async () => broken() })

  const response = await request(app, endpoint)

  expect(response.status).toBe(500)
  expect(await read(response)).toEqual({ detail: INTERNAL })
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
    qdrantCollection: 'materia_medica',
    model: 'catalog-model',
    maxOutputTokens: 4_096,
    zaiApiKey: undefined,
    openrouterApiKey: undefined,
  }

  it('caches the catalog without constructing chat providers', () => {
    const dependencies = productionDependencies({
      settings: () => settings,
      build: unexpected('catalog must not initialize chat providers'),
    })

    const first: BookCatalog = dependencies.getCatalog()

    expect(dependencies.getCatalog()).toBe(first)
    expect(first.books).toBe(BOOKS)
    expect(first.corpusVersion).toBe('materia_medica')
    expect(first.model).toBe('catalog-model')
  })

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
