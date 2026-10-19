import { expect, it } from 'vitest'

import { ProductionRetriever, type SearchableRelease } from '../src/server/retrieval.ts'
import {
  type AnswerGenerator,
  type ChatRequest,
  ChatRequestSchema,
  type RetrievedSource,
  type Retriever,
} from '../src/server/contracts.ts'
import { ChatFailure, ProviderError, ProviderTimeoutError, TokenExhaustionError } from '../src/server/errors.ts'
import { ChatService } from '../src/server/service.ts'

const request = (input: Record<string, unknown>): ChatRequest => ChatRequestSchema.parse(input)

class StubRetriever implements Retriever {
  readonly corpusVersion = '2026-08-15.v1'
  readonly modelInputLimit = 8_192
  readonly books = []
  searchCall: { request: ChatRequest; limit: number } | null = null
  failure: unknown = null

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<RetrievedSource[]> {
    this.searchCall = { request, limit }
    if (this.failure) throw this.failure
    return [
      {
        chunkId: 'chk_1',
        bookId: 'kent-lectures',
        bookTitle: "Kent's Lectures",
        author: 'James Tyler Kent',
        remedyName: 'NUX VOMICA',
        sectionTitle: 'MIND',
        passageIndexes: [3, 4],
        text: 'The patient is irritable and oversensitive.',
        score: 0.03,
      },
    ]
  }
}

class StubGenerator implements AnswerGenerator {
  readonly model = 'glm-5.3-flash'
  generationPrompt: string | null = null
  failure: unknown = null

  async generate(prompt: string, { systemInstruction }: { systemInstruction: string }): Promise<string> {
    this.generationPrompt = prompt
    expect(systemInstruction).toContain('medical advice')
    if (this.failure) throw this.failure
    return 'Kent describes irritability and oversensitivity [1].'
  }
}

async function failure(promise: Promise<unknown>): Promise<ChatFailure> {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(ChatFailure)
  return error as ChatFailure
}

it('grounds a conversation-aware answer in versioned sources', async () => {
  const retriever = new StubRetriever()
  const generator = new StubGenerator()
  const service = new ChatService({ retriever, generator })
  const chatRequest = request({
    message: 'What about irritability?',
    history: [{ role: 'user', content: 'Tell me about Nux vomica.' }],
    bookIds: ['kent-lectures'],
  })

  const response = await service.chat(chatRequest)

  expect(retriever.searchCall).toEqual({ request: chatRequest, limit: 8 })
  expect(generator.generationPrompt).toContain("[1] Kent's Lectures — NUX VOMICA — MIND")
  expect(generator.generationPrompt).toContain('untrusted user-provided context')
  expect(generator.generationPrompt).toContain('untrusted reference data')
  expect(response.answer).toBe(
    'Historical materia medica reference only—not medical advice. ' +
      'For health decisions, consult a qualified clinician.\n\n' +
      'Kent describes irritability and oversensitivity [1].',
  )
  expect(response.corpusVersion).toBe('2026-08-15.v1')
  expect(response.model).toBe('glm-5.3-flash')
  expect(response.sources[0]?.id).toBe('2026-08-15.v1/kent-lectures/chk_1')
})

it('classifies retrieval errors without exposing details', async () => {
  const retriever = new StubRetriever()
  retriever.failure = new Error('database secret')

  const error = await failure(
    new ChatService({ retriever, generator: new StubGenerator() }).chat(request({ message: 'question' })),
  )

  expect([error.stage, error.kind]).toEqual(['corpus_search', 'internal'])
  expect(error.message).not.toContain('database secret')
})

it('classifies a corpus search timeout', async () => {
  const retriever = new StubRetriever()
  retriever.failure = new ProviderTimeoutError('Qdrant request timed out')

  const error = await failure(
    new ChatService({ retriever, generator: new StubGenerator() }).chat(request({ message: 'question' })),
  )

  expect([error.stage, error.kind]).toEqual(['corpus_search', 'timeout'])
})

it('preserves the embedding failure stage', async () => {
  const retriever = new StubRetriever()
  retriever.failure = new ChatFailure({ stage: 'embedding', kind: 'timeout' })

  const error = await failure(
    new ChatService({ retriever, generator: new StubGenerator() }).chat(request({ message: 'question' })),
  )

  expect([error.stage, error.kind]).toEqual(['embedding', 'timeout'])
})

it('classifies answer provider errors', async () => {
  const generator = new StubGenerator()
  generator.failure = new ProviderError('provider secret')

  const error = await failure(
    new ChatService({ retriever: new StubRetriever(), generator }).chat(request({ message: 'question' })),
  )

  expect([error.stage, error.kind, error.errorType]).toEqual(['answer_generation', 'provider', 'ProviderError'])
  expect(error.message).not.toContain('provider secret')
})

it('classifies token exhaustion without returning partial content', async () => {
  const generator = new StubGenerator()
  generator.failure = new TokenExhaustionError()

  const error = await failure(
    new ChatService({ retriever: new StubRetriever(), generator }).chat(request({ message: 'question' })),
  )

  expect([error.stage, error.kind]).toEqual(['answer_generation', 'token_exhaustion'])
})

it('rejects an oversized history budget', () => {
  const history = Array(5).fill({ role: 'user', content: 'x'.repeat(4_000) })

  expect(() => request({ message: 'current question', history })).toThrow(/history must not exceed/)
})

it('bounds book identifiers', () => {
  expect(() => request({ message: 'question', bookIds: ['x'.repeat(65)] })).toThrow(/invalid identifier/)
})

it('production retriever embeds the conversation and filters books', async () => {
  let searchCall: unknown[] | null = null
  const corpus: SearchableRelease = {
    corpusVersion: 'local-v1',
    modelInputLimit: 8192,
    books: [],
    async search(query, embedding, { bookIds, limit }) {
      searchCall = [query, embedding, bookIds, limit]
      return []
    },
  }
  let embedded: string | null = null
  const embedder = {
    async embedQuery(text: string) {
      embedded = text
      return [1.0, 0.0]
    },
  }

  await new ProductionRetriever(corpus, embedder).retrieve(
    request({
      message: 'What about irritability?',
      history: [{ role: 'user', content: 'Tell me about Nux vomica.' }],
      bookIds: ['kent-lectures'],
    }),
    { limit: 8 },
  )

  const query = 'Tell me about Nux vomica.\nWhat about irritability?'
  expect(embedded).toBe(query)
  expect(searchCall).toEqual([query, [1.0, 0.0], ['kent-lectures'], 8])
})

it.each([
  [new ProviderTimeoutError('embedding secret'), 'timeout'],
  [new ProviderError('embedding secret'), 'provider'],
  [new TypeError('embedding secret'), 'internal'],
])('production retriever classifies embedding failures (%s)', async (cause, kind) => {
  const corpus: SearchableRelease = {
    corpusVersion: 'local-v1',
    modelInputLimit: 8192,
    books: [],
    search: async () => [],
  }
  const embedder = {
    embedQuery: async (): Promise<number[]> => {
      throw cause
    },
  }

  const error = await failure(
    new ProductionRetriever(corpus, embedder).retrieve(request({ message: 'question' }), { limit: 8 }),
  )

  expect([error.stage, error.kind]).toEqual(['embedding', kind])
  expect(error.message).not.toContain('embedding secret')
})
