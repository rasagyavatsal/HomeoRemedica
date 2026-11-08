import { describe, expect, it } from 'vitest'

import { VOYAGE_DIMENSIONS, VoyageQueryEmbedder } from '../src/server/embeddings.ts'
import { BOOKS, CorpusError, QdrantCorpus } from '../src/server/qdrant.ts'
import { ProviderError, ProviderTimeoutError } from '../src/server/errors.ts'
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

type RankedPoint = [id: string | number, score: number, remedyId?: string]
const ranked = (...points: RankedPoint[]) => ({
  points: points.map(([id, score, remedyId]) => ({ id, score, ...(remedyId ? { payload: { remedy_id: remedyId } } : {}) })),
})
const rankings = (dense: RankedPoint[], sparse: RankedPoint[]) =>
  json({ result: [ranked(...dense), ranked(...sparse)], status: 'ok' })
const records = (...points: [id: string | number, payload: Record<string, unknown>][]) =>
  json({ result: points.map(([id, payload]) => ({ id, payload })), status: 'ok' })

const corpus = (fetch: ReturnType<typeof fakeFetch>, bookIds = ['clarke_mm']) =>
  new QdrantCorpus({ url: 'https://qdrant.example/', apiKey: 'qdrant-key', bookIds, fetch })

/** Search one book whose only match has the given payload. */
const searchOne = (payload: Record<string, unknown>) =>
  corpus(fakeFetch(rankings([['p', 0.5]], []), records(['p', payload]))).search('question', [1.0], { limit: 1 })

describe('Qdrant corpus', () => {
  it('fuses global dense and per-book BM25 rankings', async () => {
    const fetch = fakeFetch(
      rankings([['c1', 0.9], ['c2', 0.5]], [['c2', 3]]),
      rankings([['k1', 0.7]], [['k1', 9], ['k2', 8]]),
      records(['k1', { ...PAYLOAD, chunk_id: 'kent-00001', source_title: 'Kent', remedy: 'Sulphur' }]),
      records(['c1', { ...PAYLOAD, chunk_id: 'clarke-00001' }], ['c2', PAYLOAD]),
    )

    const sources = await corpus(fetch, ['clarke_mm', 'kent_lectures']).search('irritability', [0.1, 0.2], { limit: 3 })

    expect(fetch.calls.map((call) => call.url)).toEqual([
      'https://qdrant.example/collections/clarke_mm/points/query/batch',
      'https://qdrant.example/collections/kent_lectures/points/query/batch',
      'https://qdrant.example/collections/kent_lectures/points',
      'https://qdrant.example/collections/clarke_mm/points',
    ])
    expect(fetch.calls.every((call) => call.method === 'POST' && call.headers['api-key'] === 'qdrant-key')).toBe(true)
    expect(fetch.calls[0]?.body).toEqual({
      searches: [
        { query: [0.1, 0.2], using: 'dense', limit: 15, with_payload: ['remedy_id'], with_vector: false },
        {
          query: { text: 'irritability', model: 'qdrant/bm25' },
          using: 'bm25',
          limit: 15,
          with_payload: ['remedy_id'],
          with_vector: false,
        },
      ],
    })
    expect(fetch.calls[3]?.body).toEqual({ ids: ['c2', 'c1'], with_payload: true, with_vector: false })
    // Dense ranks k1 second and c2 third; each tops its own book's BM25 ranking. k2 is cut.
    expect(sources.map((source) => [source.bookId, source.chunkId, source.score])).toEqual([
      ['kent_lectures', 'kent-00001', 1 / 62 + 1 / 61],
      ['clarke_mm', 'clarke-00042', 1 / 63 + 1 / 61],
      ['clarke_mm', 'clarke-00001', 1 / 61],
    ])
    expect(sources[1]).toEqual({
      chunkId: 'clarke-00042',
      bookId: 'clarke_mm',
      bookTitle: 'Clarke, A Dictionary of Practical Materia Medica',
      author: 'John Henry Clarke',
      remedyName: 'Nux Vomica',
      sectionTitle: 'Symptoms: Mind; Head',
      passageIndexes: [3],
      text: 'Irritable, oversensitive to noise.',
      score: 1 / 63 + 1 / 61,
    })
  })

  it('ranks remedies by support across books when none dominates the results', async () => {
    // Three nosodes each match in the dense ranking and in their own book; Pulsatilla tops the
    // BM25 ranking of three other books but is missing from the dense ranking.
    const fetch = fakeFetch(
      rankings([], [['a1', 9, 'pulsatilla']]),
      rankings(
        [['n1', 0.9, 'lyssin'], ['n2', 0.8, 'x-ray'], ['n3', 0.7, 'psorinum']],
        [['n1', 9, 'lyssin'], ['n2', 8, 'x-ray'], ['n3', 7, 'psorinum']],
      ),
      rankings([], [['c1', 9, 'pulsatilla']]),
      rankings([], [['k1', 9, 'pulsatilla']]),
      records(['a1', { ...PAYLOAD, remedy: 'Pulsatilla' }]),
      records(['n1', { ...PAYLOAD, remedy: 'Lyssin' }], ['n2', { ...PAYLOAD, remedy: 'X-Ray' }]),
    )

    const sources = await corpus(fetch, ['allen_keynotes', 'allen_nosodes', 'clarke_mm', 'kent_lectures']).search(
      'weeps easily, thirstless, better in open air',
      [1.0],
      { limit: 3 },
    )

    expect(sources.map((source) => [source.bookId, source.remedyName])).toEqual([
      ['allen_keynotes', 'Pulsatilla'],
      ['allen_nosodes', 'Lyssin'],
      ['allen_nosodes', 'X-Ray'],
    ])
  })

  it('reports the candidates of each step without fetching passages', async () => {
    const fetch = fakeFetch(
      rankings([], [['a1', 9, 'pulsatilla']]),
      rankings([['n1', 0.9, 'lyssin'], ['n2', 0.8, 'x-ray']], [['n2', 8, 'x-ray']]),
    )

    const stages = await corpus(fetch, ['allen_keynotes', 'allen_nosodes']).stages('weepy', [1.0], { limit: 3 })

    expect(fetch.calls).toHaveLength(2)
    const subjects = (candidates: readonly { subject: string }[]) => candidates.map((candidate) => candidate.subject)
    expect(subjects(stages.dense)).toEqual(['remedy:lyssin', 'remedy:x-ray'])
    expect(stages.sparse.map(subjects)).toEqual([['remedy:pulsatilla'], ['remedy:x-ray']])
    expect(subjects(stages.fused)).toEqual(['remedy:x-ray', 'remedy:lyssin', 'remedy:pulsatilla'])
    expect(stages.support).toEqual(['remedy:x-ray', 'remedy:lyssin', 'remedy:pulsatilla'])
    expect(subjects(stages.best)).toEqual(['remedy:x-ray', 'remedy:lyssin', 'remedy:pulsatilla'])
  })

  it('keeps the fused order when regrouping is off', async () => {
    const fetch = fakeFetch(
      rankings([], [['a1', 9, 'pulsatilla']]),
      rankings(
        [['n1', 0.9, 'lyssin'], ['n2', 0.8, 'x-ray'], ['n3', 0.7, 'psorinum']],
        [['n1', 9, 'lyssin'], ['n2', 8, 'x-ray'], ['n3', 7, 'psorinum']],
      ),
      records(
        ['n1', { ...PAYLOAD, remedy: 'Lyssin' }],
        ['n2', { ...PAYLOAD, remedy: 'X-Ray' }],
        ['n3', { ...PAYLOAD, remedy: 'Psorinum' }],
      ),
    )
    const unregrouped = new QdrantCorpus({
      url: 'https://qdrant.example/',
      bookIds: ['allen_keynotes', 'allen_nosodes'],
      fetch,
      regroup: false,
    })

    const sources = await unregrouped.search('weeps easily, thirstless, better in open air', [1.0], { limit: 3 })

    expect(sources.map((source) => source.remedyName)).toEqual(['Lyssin', 'X-Ray', 'Psorinum'])
  })

  it("shows a narrowed search's remedies in the order given", async () => {
    const fetch = fakeFetch(
      rankings(
        [['p1', 0.9, 'pulsatilla'], ['p2', 0.8, 'pulsatilla'], ['s1', 0.7, 'sepia'], ['n1', 0.6, 'natrum-muriaticum']],
        [['p1', 9, 'pulsatilla'], ['p2', 8, 'pulsatilla'], ['s1', 7, 'sepia'], ['n1', 6, 'natrum-muriaticum']],
      ),
      records(
        ['n1', { ...PAYLOAD, remedy: 'Natrum Muriaticum' }],
        ['s1', { ...PAYLOAD, remedy: 'Sepia' }],
        ['p1', { ...PAYLOAD, remedy: 'Pulsatilla' }],
      ),
    )
    const ordered = new QdrantCorpus({ url: 'https://qdrant.example/', bookIds: ['allen_keynotes'], fetch, remedyOrder: true })

    const sources = await ordered.search('weepy', [1.0], {
      limit: 3,
      remedies: ['natrum-muriaticum', 'gelsemium', 'sepia', 'pulsatilla'],
    })

    // Gelsemium has no passage; Pulsatilla's second passage is cut.
    expect(sources.map((source) => source.remedyName)).toEqual(['Natrum Muriaticum', 'Sepia', 'Pulsatilla'])
  })

  it.each([
    [{ section_group: 'Mind', sections: ['Mind'] }, 'Mind'],
    [{ section_group: null, sections: ['Mind', 'Head'] }, 'Mind; Head'],
    [{ section_group: null, sections: null }, ''],
    [{ section_group: 'Organon of Medicine', sections: [], aphorisms: [28, 29] }, 'Organon of Medicine: §§ 28–29'],
    [{ section_group: 'Organon of Medicine', sections: [], aphorisms: [5] }, 'Organon of Medicine: § 5'],
    [{ section_group: null, sections: ['Notes'], aphorisms: [3, 7] }, 'Notes; §§ 3, 7'],
  ])('builds section titles from %j', async (sections, title) => {
    const [source] = await searchOne({ ...PAYLOAD, ...sections })

    expect(source?.sectionTitle).toBe(title)
  })

  it("searches only the given remedies' passages", async () => {
    const fetch = fakeFetch(rankings([['p', 0.5, 'pulsatilla']], []), records(['p', PAYLOAD]))

    await corpus(fetch).search('weepy', [1.0], { limit: 1, remedies: ['pulsatilla', 'sepia'] })

    const filter = { must: [{ key: 'remedy_id', match: { any: ['pulsatilla', 'sepia'] } }] }
    const searches = (fetch.calls[0]?.body as { searches: Record<string, unknown>[] }).searches
    expect(searches.map((search) => search.filter)).toEqual([filter, filter])
  })

  it('accepts passages without a remedy', async () => {
    const [source] = await searchOne({ ...PAYLOAD, remedy: null })

    expect(source?.remedyName).toBeNull()
  })

  it('rejects points without required payload fields', async () => {
    const { chunk_id: _, ...payload } = PAYLOAD

    await expect(searchOne(payload)).rejects.toThrow(/chunk_id/)
  })

  it('rejects ranked points that have no stored payload', async () => {
    const fetch = fakeFetch(rankings([['p', 0.5]], []), records())

    await expect(corpus(fetch).search('question', [1.0], { limit: 1 })).rejects.toThrow(/no payload/)
  })

  it('raises provider errors without the response body', async () => {
    const fetch = fakeFetch(new Response('provider secret', { status: 500 }))

    const error = await corpus(fetch)
      .search('question', [1.0], { limit: 1 })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ProviderError)
    expect(String(error)).not.toContain('provider secret')
  })

  it('searches every book by default', () => {
    expect(BOOKS.map((book) => book.bookId)).toEqual([
      'allen_keynotes',
      'allen_nosodes',
      'boericke_mm',
      'clarke_mm',
      'hahnemann_mm_pura',
      'hahnemann_organon',
      'kent_lectures',
    ])
  })

  it('verifies that every book collection exists', async () => {
    const fetch = fakeFetch(json({ result: { exists: true } }), json({ result: { exists: true } }))

    await corpus(fetch, ['clarke_mm', 'kent_lectures']).verify()

    expect(fetch.calls.map((call) => call.url)).toEqual([
      'https://qdrant.example/collections/clarke_mm/exists',
      'https://qdrant.example/collections/kent_lectures/exists',
    ])
  })

  it.each([
    [[json({ result: { exists: true } }), json({ result: { exists: false } })], '"kent_lectures" do not exist'],
    [[new TypeError('secret host')], 'could not reach'],
    [[json({ result: { exists: true } }), new Response('secret host', { status: 403 })], 'could not reach'],
  ])('reports missing or unreachable collections', async (responses, message) => {
    const error = await corpus(fakeFetch(...responses), ['clarke_mm', 'kent_lectures'])
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

  it('embeds several queries in one request, in input order', async () => {
    const [first, second] = [Array(VOYAGE_DIMENSIONS).fill(0.1), Array(VOYAGE_DIMENSIONS).fill(0.2)]
    const fetch = fakeFetch(json({ data: [{ index: 1, embedding: second }, { index: 0, embedding: first }] }))

    expect(await embedder(fetch).embedQueries(['one', 'two'])).toEqual([first, second])
    expect(fetch.calls[0]?.body).toMatchObject({ input: ['one', 'two'] })
  })

  it('rejects a missing embedding', async () => {
    const fetch = fakeFetch(json({ data: [{ index: 0, embedding: Array(VOYAGE_DIMENSIONS).fill(0.1) }] }))

    await expect(embedder(fetch).embedQueries(['one', 'two'])).rejects.toThrow(/one embedding per input/)
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
