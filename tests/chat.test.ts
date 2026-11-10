import { describe, expect, it } from 'vitest'

import { ProductionRetriever, type SearchableRelease } from '../src/server/retrieval.ts'
import { CONTEXT_CHARS, CONTEXT_TURNS } from '../src/web/conversation.ts'
import {
  type AnswerGenerator,
  type ChatRequest,
  ChatRequestSchema,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_TURNS,
  type GenerateOptions,
  type Retrieval,
  type Retriever,
} from '../src/server/contracts.ts'
import { ProviderError, ProviderTimeoutError, TokenExhaustionError } from '../src/server/errors.ts'
import { ChatService } from '../src/server/service.ts'

const request = (input: Record<string, unknown>): ChatRequest => ChatRequestSchema.parse(input)

class StubRetriever implements Retriever {
  searchCall: { request: ChatRequest; limit: number } | null = null
  failure: unknown = null

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<Retrieval> {
    this.searchCall = { request, limit }
    if (this.failure) throw this.failure
    return {
      repertory: [],
      clinical: [],
      sources: [
        {
        chunkId: 'chk_1',
        bookId: 'kent_lectures',
        bookTitle: "Kent's Lectures",
        author: 'James Tyler Kent',
        remedyName: 'NUX VOMICA',
        sectionTitle: 'MIND',
        passageIndexes: [3, 4],
        text: 'The patient is irritable and oversensitive.',
        score: 0.03,
      },
      ],
    }
  }
}

class StubGenerator implements AnswerGenerator {
  readonly model = 'glm-5.3-flash'
  generationPrompt: string | null = null
  signal: AbortSignal | undefined
  failure: unknown = null
  pieces = ['Kent describes irritability ', 'and oversensitivity [1].']

  async generate(prompt: string, { systemInstruction, onText, signal }: GenerateOptions): Promise<string> {
    this.generationPrompt = prompt
    this.signal = signal
    expect(systemInstruction).toContain('medical advice')
    if (this.failure) throw this.failure
    for (const piece of this.pieces) onText?.(piece)
    return this.pieces.join('')
  }
}

it('grounds a conversation-aware answer in versioned sources', async () => {
  const retriever = new StubRetriever()
  const generator = new StubGenerator()
  const service = new ChatService({ retriever, generator })
  const chatRequest = request({
    message: 'What about irritability?',
    history: [{ role: 'user', content: 'Tell me about Nux vomica.' }],
  })

  const response = await service.chat(chatRequest)

  expect(retriever.searchCall).toEqual({ request: chatRequest, limit: 5 })
  expect(generator.generationPrompt).toContain("[1] Kent's Lectures — NUX VOMICA — MIND")
  expect(generator.generationPrompt).toContain('untrusted user-provided context')
  expect(generator.generationPrompt).toContain('untrusted reference data')
  expect(response.answer).toBe('Kent describes irritability and oversensitivity [1].')
  expect(response.corpusVersion).toBe('homeoremedica')
  expect(response.model).toBe('glm-5.3-flash')
  expect(response.sources[0]?.id).toBe('homeoremedica/kent_lectures/chk_1')
})

it('names passages without a remedy by their section', async () => {
  const retriever = new StubRetriever()
  const retrieval = await retriever.retrieve(request({ message: 'question' }), { limit: 1 })
  const source = retrieval.sources[0]!
  retriever.retrieve = async () => ({
    ...retrieval,
    sources: [{ ...source, bookTitle: 'Hahnemann, Organon of Medicine', remedyName: null, sectionTitle: 'Organon of Medicine: § 5' }],
  })
  const generator = new StubGenerator()

  await new ChatService({ retriever, generator }).chat(request({ message: 'What is § 5 about?' }))

  expect(generator.generationPrompt).toContain('[1] Hahnemann, Organon of Medicine — Organon of Medicine: § 5\n')
})

it('gives the model the rankings with the rubrics they point to, and cites the rubrics', async () => {
  const retriever = new StubRetriever()
  const retrieval = await retriever.retrieve(request({ message: 'question' }), { limit: 5 })
  retriever.retrieve = async () => ({
    sources: [
      ...retrieval.sources,
      {
        chunkId: 'kent_repertory-00042',
        bookId: 'kent_repertory',
        bookTitle: 'Kent, Repertory of the Homoeopathic Materia Medica',
        author: 'James Tyler Kent',
        remedyName: null,
        sectionTitle: 'Mind: irritability',
        passageIndexes: [],
        text: 'Remedies and their grades: Nux vomica (3)',
        score: 0,
      },
    ],
    repertory: [
      { remedyName: 'Nux vomica', matched: [{ text: 'Mind: irritable', source: 2 }, { text: 'Sleep: waking at 3 a.m.' }] },
    ],
    clinical: [{ remedyName: 'Colocynthis', matched: [{ text: 'sciatica' }] }],
  })
  const generator = new StubGenerator()

  const response = await new ChatService({ retriever, generator }).chat(request({ message: 'An irritable man with sciatica.' }))

  expect(generator.generationPrompt).toContain(
    '<repertory_ranking>\n1. Nux vomica: Mind: irritable [2]; Sleep: waking at 3 a.m.\n</repertory_ranking>\n' +
      '<clinical_ranking>\n1. Colocynthis: sciatica\n</clinical_ranking>\n',
  )
  expect(generator.generationPrompt).toContain(
    '[2] Kent, Repertory of the Homoeopathic Materia Medica — Mind: irritability\nRemedies and their grades: Nux vomica (3)',
  )
  expect(response.sources.map((source) => source.id)).toEqual([
    'homeoremedica/kent_lectures/chk_1',
    'homeoremedica/kent_repertory/kent_repertory-00042',
  ])
})

it('gives the model no rankings when there are none', async () => {
  const generator = new StubGenerator()

  await new ChatService({ retriever: new StubRetriever(), generator }).chat(request({ message: 'question' }))

  expect(generator.generationPrompt).not.toContain('ranking')
})

it('reports sources before streaming answer text', async () => {
  const generator = new StubGenerator()
  const events: string[] = []
  const controller = new AbortController()

  const response = await new ChatService({ retriever: new StubRetriever(), generator }).chat(request({ message: 'question' }), {
    onSources: (sources) => events.push(`sources:${sources.map((source) => source.id).join()}`),
    onText: (text) => events.push(`text:${text}`),
    signal: controller.signal,
  })

  expect(events).toEqual([
    'sources:homeoremedica/kent_lectures/chk_1',
    'text:Kent describes irritability ',
    'text:and oversensitivity [1].',
  ])
  expect(response.sources.map((source) => source.id)).toEqual(['homeoremedica/kent_lectures/chk_1'])
  expect(generator.signal).toBe(controller.signal)
})

it('streams no more than the answer limit', async () => {
  const generator = new StubGenerator()
  generator.pieces = ['a'.repeat(11_000), 'b'.repeat(2_000), 'c']
  let streamed = ''

  const response = await new ChatService({ retriever: new StubRetriever(), generator }).chat(request({ message: 'question' }), {
    onText: (text) => {
      streamed += text
    },
  })

  expect(streamed).toBe(`${'a'.repeat(11_000)}${'b'.repeat(1_000)}`)
  expect(response.answer).toBe(`${streamed}…`)
})

it('leaves a retrieval failure for the caller to classify', async () => {
  const retriever = new StubRetriever()
  retriever.failure = new ProviderTimeoutError('Qdrant request timed out')

  await expect(
    new ChatService({ retriever, generator: new StubGenerator() }).chat(request({ message: 'question' })),
  ).rejects.toBe(retriever.failure)
})

it.each([new ProviderError('provider secret'), new TokenExhaustionError()])(
  'leaves an answer failure for the caller to classify (%s)',
  async (cause) => {
    const generator = new StubGenerator()
    generator.failure = cause

    await expect(
      new ChatService({ retriever: new StubRetriever(), generator }).chat(request({ message: 'question' })),
    ).rejects.toBe(cause)
  },
)

it('rejects oversized citation text before generating an answer', async () => {
  const retriever = new StubRetriever()
  const generator = new StubGenerator()
  const retrieval = await retriever.retrieve(request({ message: 'question' }), { limit: 8 })
  retriever.retrieve = async () => ({ ...retrieval, sources: [{ ...retrieval.sources[0]!, text: 'x'.repeat(8_001) }] })

  await expect(new ChatService({ retriever, generator }).chat(request({ message: 'question' }))).rejects.toThrow(
    RangeError,
  )
  expect(generator.generationPrompt).toBeNull()
})

it('answers without the model when retrieval finds no sources', async () => {
  const retriever = new StubRetriever()
  retriever.retrieve = async () => ({ sources: [], repertory: [], clinical: [] })
  const generator = new StubGenerator()

  const streamed: string[] = []

  const response = await new ChatService({ retriever, generator }).chat(request({ message: 'question' }), {
    onText: (text) => streamed.push(text),
  })

  expect(generator.generationPrompt).toBeNull()
  expect(response.answer).toContain('No passages in the corpus matched this question.')
  expect(streamed).toEqual([response.answer])
  expect(response.sources).toEqual([])
})

it('rejects an oversized history budget', () => {
  const history = Array(5).fill({ role: 'user', content: 'x'.repeat(4_000) })

  expect(() => request({ message: 'current question', history })).toThrow(/history must not exceed/)
})

it('gives the model a compacted chat’s summary before its history', async () => {
  const generator = new StubGenerator()

  await new ChatService({ retriever: new StubRetriever(), generator }).chat(
    request({
      message: 'And its mental symptoms?',
      history: [{ role: 'user', content: 'What about Sepia?' }],
      summary: 'The user asked about Nux vomica.',
    }),
  )

  expect(generator.generationPrompt).toContain(
    '<summary>The user asked about Nux vomica.</summary>\n<user>What about Sepia?</user>\n<latest_user_message>',
  )
})

describe('compaction', () => {
  const history = [
    { role: 'user' as const, content: 'Tell me about Nux vomica.' },
    { role: 'assistant' as const, content: 'Nux vomica suits irritable patients [1].' },
    { role: 'user' as const, content: 'What about Sepia?' },
    { role: 'assistant' as const, content: 'Sepia is indifferent to loved ones [2].' },
  ]

  /** A generator that records its one call and answers with `summary`. */
  function summarizer(summary: string | Error) {
    const calls: { prompt: string; systemInstruction: string }[] = []
    const generator: AnswerGenerator = {
      model: 'glm-5.3-flash',
      async generate(prompt, { systemInstruction }) {
        calls.push({ prompt, systemInstruction })
        if (summary instanceof Error) throw summary
        return summary
      },
    }
    return { calls, service: new ChatService({ retriever: new StubRetriever(), generator }) }
  }

  it('condenses the earlier summary and all but the latest exchange', async () => {
    const { calls, service } = summarizer('  The user asked about Nux vomica.  ')

    const response = await service.compact({ history, summary: 'Earlier, Arnica.' })

    expect(response).toEqual({ summary: 'The user asked about Nux vomica.', history: history.slice(2) })
    expect(calls[0]?.systemInstruction).toContain('untrusted data')
    expect(calls[0]?.prompt).toContain(
      '<summary>Earlier, Arnica.</summary>\n<user>Tell me about Nux vomica.</user>\n' +
        '<assistant>Nux vomica suits irritable patients [1].</assistant>\n</conversation>',
    )
    expect(calls[0]?.prompt).not.toContain('Sepia')
  })

  it('keeps the summary within one turn', async () => {
    const { service } = summarizer('s'.repeat(5_000))

    const { summary } = await service.compact({ history })

    expect(summary).toHaveLength(4_000)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('leaves a provider failure for the caller to classify', async () => {
    const cause = new ProviderTimeoutError('provider secret')
    const { service } = summarizer(cause)

    await expect(service.compact({ history })).rejects.toBe(cause)
  })
})

it('gives the browser the same context limits the server keeps', () => {
  expect([CONTEXT_CHARS, CONTEXT_TURNS]).toEqual([MAX_HISTORY_CHARS, MAX_HISTORY_TURNS])
})

it('rejects book filters', () => {
  expect(() => request({ message: 'question', bookIds: ['kent_lectures'] })).toThrow(/unexpected request field/)
})

it('production retriever searches on recent questions only', async () => {
  let embedded: string | null = null
  const corpus: SearchableRelease = { search: async () => [] }
  const embedder = {
    async embedQuery(text: string) {
      embedded = text
      return [1.0, 0.0]
    },
  }

  await new ProductionRetriever(corpus, embedder).retrieve(
    request({
      message: 'And its mental symptoms?',
      history: [
        { role: 'user', content: 'Tell me about Nux vomica.' },
        { role: 'assistant', content: 'Nux vomica suits irritable patients [1].' },
        { role: 'user', content: 'What about Sepia?' },
        { role: 'assistant', content: 'Sepia is indifferent to loved ones [2].' },
        { role: 'user', content: 'Compare it with Pulsatilla.' },
        { role: 'assistant', content: 'Pulsatilla is mild and weepy [3].' },
      ],
    }),
    { limit: 8 },
  )

  expect(embedded).toBe('What about Sepia?\nCompare it with Pulsatilla.\nAnd its mental symptoms?')
})

it('production retriever embeds the conversation', async () => {
  let searchCall: unknown[] | null = null
  const corpus: SearchableRelease = {
    async search(query, embedding, { limit }) {
      searchCall = [query, embedding, limit]
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
    }),
    { limit: 8 },
  )

  const query = 'Tell me about Nux vomica.\nWhat about irritability?'
  expect(embedded).toBe(query)
  expect(searchCall).toEqual([query, [1.0, 0.0], 8])
})

it('production retriever leaves an embedding failure for the caller to classify', async () => {
  const cause = new ProviderError('embedding secret')
  const corpus: SearchableRelease = {
    search: async () => [],
  }
  const embedder = {
    embedQuery: async (): Promise<number[]> => {
      throw cause
    },
  }

  await expect(
    new ProductionRetriever(corpus, embedder).retrieve(request({ message: 'question' }), { limit: 8 }),
  ).rejects.toBe(cause)
})
