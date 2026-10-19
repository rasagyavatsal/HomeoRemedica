import { describe, expect, it } from 'vitest'

import { VOYAGE_DIMENSIONS, VoyageQueryEmbedder } from '../src/production/embeddings.ts'
import { CorpusError, QdrantCorpus } from '../src/production/qdrant.ts'
import { ChatRequestSchema } from '../src/shared/contracts.ts'
import { ProviderError, ProviderTimeoutError } from '../src/shared/errors.ts'
import { fakeFetch, json, timeout } from './fakes.ts'

const PAYLOAD = {
  chunk_id: 'clarke-00042',
  source: 'clarke',
  source_title: 'Clarke, A Dictionary of Practical Materia Medica',
  author: 'John Henry Clarke',
  remedy: 'Nux Vomica',
  section_group: 'Symptoms',
  sections: ['Mind', 'Head'],
  chunk_index: 3,
  content: 'Irritable, oversensitive to noise.',
  text: 'Clarke > Nux Vomica > Mind; Head\n\nIrritable, oversensitive to noise.',
}
const points = () => json({ result: { points: [{ id: 1, score: 0.5, payload: PAYLOAD }] }, status: 'ok' })

const corpus = (fetch: ReturnType<typeof fakeFetch>) =>
  new QdrantCorpus({ url: 'https://qdrant.example/', apiKey: 'qdrant-key', fetch })

describe('Qdrant corpus', () => {
  it('fuses dense and server-side BM25 rankings with a book filter', async () => {
    const fetch = fakeFetch(points())

    const sources = await corpus(fetch).search('irritability', [0.1, 0.2], { bookIds: ['clarke', 'kent'], limit: 8 })

    const [call] = fetch.calls
    const filter = { must: [{ key: 'source', match: { any: ['clarke', 'kent'] } }] }
    expect(call?.url).toBe('https://qdrant.example/collections/materia_medica/points/query')
    expect(call?.method).toBe('POST')
    expect(call?.headers['api-key']).toBe('qdrant-key')
    expect(call?.body).toEqual({
      prefetch: [
        { query: [0.1, 0.2], using: 'dense', filter, limit: 40 },
        { query: { text: 'irritability', model: 'qdrant/bm25' }, using: 'bm25', filter, limit: 40 },
      ],
      query: { fusion: 'rrf' },
      limit: 8,
      with_payload: true,
      with_vector: false,
    })
    expect(sources).toEqual([
      {
        chunkId: 'clarke-00042',
        bookId: 'clarke',
        bookTitle: 'Clarke, A Dictionary of Practical Materia Medica',
        author: 'John Henry Clarke',
        remedyName: 'Nux Vomica',
        sectionTitle: 'Symptoms: Mind; Head',
        passageIndexes: [3],
        text: 'Irritable, oversensitive to noise.',
        score: 0.5,
      },
    ])
  })

  it('searches without a filter when no books are selected', async () => {
    const fetch = fakeFetch(points())

    await corpus(fetch).search('question', [1.0], { bookIds: null, limit: 2 })

    const { prefetch } = fetch.calls[0]?.body as { prefetch: object[] }
    expect(prefetch.every((stage) => !('filter' in stage))).toBe(true)
  })

  it.each([
    [{ section_group: 'Mind', sections: ['Mind'] }, 'Mind'],
    [{ section_group: null, sections: ['Mind', 'Head'] }, 'Mind; Head'],
    [{ section_group: null, sections: null }, ''],
  ])('builds section titles from %j', async (sections, title) => {
    const fetch = fakeFetch(json({ result: { points: [{ score: 1, payload: { ...PAYLOAD, ...sections } }] } }))

    const [source] = await corpus(fetch).search('question', [1.0], { bookIds: null, limit: 1 })

    expect(source?.sectionTitle).toBe(title)
  })

  it('rejects points without required payload fields', async () => {
    const { chunk_id: _, ...payload } = PAYLOAD
    const fetch = fakeFetch(json({ result: { points: [{ score: 1, payload }] } }))

    await expect(corpus(fetch).search('question', [1.0], { bookIds: null, limit: 1 })).rejects.toThrow(/chunk_id/)
  })

  it('raises provider errors without the response body', async () => {
    const fetch = fakeFetch(new Response('provider secret', { status: 500 }))

    const error = await corpus(fetch)
      .search('question', [1.0], { bookIds: null, limit: 1 })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ProviderError)
    expect(String(error)).not.toContain('provider secret')
  })

  it('catalog book IDs are valid request IDs', () => {
    const bookIds = corpus(fakeFetch()).books.map((book) => book.bookId)

    expect(bookIds).toEqual(['allen', 'boericke', 'clarke', 'kent'])
    expect(ChatRequestSchema.parse({ message: 'question', bookIds }).bookIds).toEqual(bookIds)
  })

  it('verifies that the collection exists', async () => {
    const fetch = fakeFetch(json({ result: { exists: true } }))

    await corpus(fetch).verify()

    expect(fetch.calls[0]?.url).toBe('https://qdrant.example/collections/materia_medica/exists')
  })

  it.each([
    [json({ result: { exists: false } }), 'does not exist'],
    [new TypeError('secret host'), 'could not reach'],
    [new Response('secret host', { status: 403 }), 'could not reach'],
  ])('reports a missing or unreachable collection', async (response, message) => {
    const error = await corpus(fakeFetch(response))
      .verify()
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(CorpusError)
    expect(String(error)).toContain(message)
    expect(String(error)).not.toContain('secret host')
  })
})

describe('voyage query embedder', () => {
  const embedder = (fetch: ReturnType<typeof fakeFetch>) =>
    new VoyageQueryEmbedder({ apiKey: 'key', fetch, sleep: async () => {} })

  it('requests voyage query vectors and retries transient failures', async () => {
    const vector = Array(VOYAGE_DIMENSIONS).fill(0.5)
    const fetch = fakeFetch(json({}, 429), json({ data: [{ index: 0, embedding: vector }] }))

    const embedding = await embedder(fetch).embedQuery('question')

    expect(embedding).toEqual(vector)
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[0]?.url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect(fetch.calls[0]?.headers.Authorization).toBe('Bearer key')
    expect(fetch.calls[0]?.body).toEqual({
      model: 'voyageai/voyage-4',
      input: ['question'],
      input_type: 'query',
      dimensions: VOYAGE_DIMENSIONS,
      encoding_format: 'float',
    })
  })

  it('gives up after three attempts', async () => {
    const fetch = fakeFetch(json({}, 503), json({}, 503), json({}, 503))

    await expect(embedder(fetch).embedQuery('question')).rejects.toThrow(/status 503/)
    expect(fetch.calls).toHaveLength(3)
  })

  it('rejects wrong dimensions', async () => {
    const fetch = fakeFetch(json({ data: [{ embedding: [0.1, 0.2] }] }))

    await expect(embedder(fetch).embedQuery('question')).rejects.toThrow(/1024 dimensions/)
  })

  it('classifies timeouts without exposing details', async () => {
    const error = await embedder(fakeFetch(timeout()))
      .embedQuery('question')
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ProviderTimeoutError)
    expect(String(error)).not.toContain('timeout secret')
  })

  it('requires a key', () => {
    expect(() => new VoyageQueryEmbedder({ apiKey: undefined })).toThrow(/OPENROUTER_API_KEY/)
  })
})
