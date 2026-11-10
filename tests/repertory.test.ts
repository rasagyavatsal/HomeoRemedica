import { describe, expect, it, vi } from 'vitest'

import { ChatRequestSchema, type ChatRequest } from '../src/server/contracts.ts'
import { ProviderError } from '../src/server/errors.ts'
import {
  CombinedRubrics,
  MAX_SYMPTOMS,
  ModelSymptomExtractor,
  QdrantRubrics,
  type Repertoriser,
  Repertory,
  type Rubric,
  decisive,
  parseSymptoms,
  rankRemedies,
} from '../src/server/repertory.ts'
import { ProductionRetriever, type SearchableRelease } from '../src/server/retrieval.ts'
import { fakeFetch, json } from './fakes.ts'

const rubric = (text: string, ...remedies: [string, number][]): Rubric => ({
  id: text,
  chapter: text.split(':')[0]!,
  text,
  remedies,
})

const request = (message: string): ChatRequest => ChatRequestSchema.parse({ message })

describe('rankRemedies', () => {
  it('ranks by symptoms covered, then by grades', () => {
    const ranked = rankRemedies([
      { symptom: 'Mind: irritable', rubrics: [rubric('Mind: irritability', ['nux', 3], ['sulph', 1])] },
      { symptom: 'Stomach: thirstless', rubrics: [rubric('Stomach: thirstless', ['puls', 3], ['sulph', 1])] },
      { symptom: 'Sleep: waking at 3 a.m.', rubrics: [rubric('Sleep: waking, 3 a.m.', ['nux', 1], ['sulph', 2])] },
    ])

    expect(ranked).toEqual([
      { remedyId: 'sulph', symptoms: 3, grades: 4 },
      { remedyId: 'nux', symptoms: 2, grades: 4 },
      { remedyId: 'puls', symptoms: 1, grades: 3 },
    ])
  })

  it('counts a remedy once per symptom, at its best grade', () => {
    const ranked = rankRemedies([
      {
        symptom: 'Head: pain, morning',
        rubrics: [rubric('Head: pain, morning', ['bry', 1]), rubric('Head: pain, morning, rising', ['bry', 3])],
      },
    ])

    expect(ranked).toEqual([{ remedyId: 'bry', symptoms: 1, grades: 3 }])
  })
})

describe('decisive', () => {
  const symptoms = (count: number) => Array.from({ length: count }, (_, index) => ({ symptom: `Mind: ${index}`, rubrics: [] }))
  const remedies = (...covered: number[]) =>
    covered.map((symptoms, index) => ({ remedyId: `remedy-${index}`, symptoms, grades: symptoms }))

  it('is not when many remedies lead together on one symptom or under half of them', () => {
    expect(decisive({ symptoms: symptoms(1), remedies: remedies(1, 1, 1, 1, 1) })).toBe(false)
    expect(decisive({ symptoms: symptoms(7), remedies: remedies(3, 3, 3, 3, 3, 2) })).toBe(false)
    expect(decisive({ symptoms: [], remedies: [] })).toBe(false)
  })

  it('is when few remedies lead, or the lead covers half of the symptoms', () => {
    expect(decisive({ symptoms: symptoms(1), remedies: remedies(1, 1, 1, 1) })).toBe(true)
    expect(decisive({ symptoms: symptoms(7), remedies: remedies(3, 2, 2, 2, 2, 2) })).toBe(true)
    expect(decisive({ symptoms: symptoms(6), remedies: remedies(3, 3, 3, 3, 3, 3) })).toBe(true)
  })
})

describe('parseSymptoms', () => {
  it('keeps chapter lines, in the repertory chapters, with their spelling', () => {
    const reply = [
      'Here are the symptoms:',
      '1. mind: fretful, worse at night',
      '- Larynx and trachea: hoarse',
      '* Elbow: pain',
      '',
      'Stool: green, sour',
    ].join('\n')

    expect(parseSymptoms(reply)).toEqual(['Mind: fretful, worse at night', 'Larynx and Trachea: hoarse', 'Stool: green, sour'])
  })

  it('reads NONE as no symptoms and keeps at most the limit', () => {
    expect(parseSymptoms('NONE')).toEqual([])
    expect(parseSymptoms(Array(20).fill('Head: pain').join('\n'))).toHaveLength(MAX_SYMPTOMS)
  })

  it('asks the model with the case as data', async () => {
    const calls: [string, string][] = []
    const extractor = new ModelSymptomExtractor({
      model: 'm',
      async generate(prompt, { systemInstruction }) {
        calls.push([prompt, systemInstruction])
        return 'Mind: weeping'
      },
    })

    expect(await extractor.extractSymptoms('A child weeps.')).toEqual(['Mind: weeping'])
    expect(calls[0]![0]).toBe('<case>\nA child weeps.\n</case>')
    expect(calls[0]![1]).toContain('reply only NONE')
  })
})

describe('Repertory', () => {
  it('matches each symptom to its rubrics and ranks the remedies', async () => {
    const searched: unknown[] = []
    const repertory = new Repertory({
      extractor: { extractSymptoms: async () => ['Mind: weeping', 'Stomach: thirstless'] },
      embedder: { embedQueries: async (texts) => texts.map((_, index) => [index]) },
      rubrics: {
        async search(embeddings, { limit }) {
          searched.push(embeddings, limit)
          return [[rubric('Mind: weeping', ['puls', 3])], [rubric('Stomach: thirstless', ['puls', 2], ['gels', 2])]]
        },
      },
    })

    const result = await repertory.repertorise('case')

    expect(searched).toEqual([[[0], [1]], 3])
    expect(result.symptoms.map((match) => [match.symptom, match.rubrics.map((found) => found.text)])).toEqual([
      ['Mind: weeping', ['Mind: weeping']],
      ['Stomach: thirstless', ['Stomach: thirstless']],
    ])
    expect(result.remedies.map((remedy) => remedy.remedyId)).toEqual(['puls', 'gels'])
  })

  it('searches nothing for a question that describes no patient', async () => {
    const embedQueries = vi.fn()
    const repertory = new Repertory({
      extractor: { extractSymptoms: async () => [] },
      embedder: { embedQueries },
      rubrics: { search: vi.fn() },
    })

    expect(await repertory.repertorise('What is Sulphur?')).toEqual({ symptoms: [], remedies: [] })
    expect(embedQueries).not.toHaveBeenCalled()
  })
})

describe('CombinedRubrics', () => {
  it("takes each symptom's nearest rubrics from every repertory, one after another", async () => {
    const kent = { search: vi.fn(async () => [[rubric('Mind: weeping', ['puls', 3])], [rubric('Stomach: thirstless', ['puls', 2])]]) }
    const boericke = { search: vi.fn(async () => [[rubric('Mind: weeping, from music', ['nat-s', 1])], []]) }

    const found = await new CombinedRubrics([kent, boericke]).search([[0], [1]], { limit: 3 })

    expect(kent.search).toHaveBeenCalledWith([[0], [1]], { limit: 3 })
    expect(boericke.search).toHaveBeenCalledWith([[0], [1]], { limit: 3 })
    expect(found.map((rubrics) => rubrics.map((found) => found.text))).toEqual([
      ['Mind: weeping', 'Mind: weeping, from music'],
      ['Stomach: thirstless'],
    ])
  })
})

describe('Qdrant rubrics', () => {
  const rubrics = (fetch: ReturnType<typeof fakeFetch>) =>
    new QdrantRubrics({ url: 'https://qdrant.example/', apiKey: 'qdrant-key', fetch })
  const point = (payload: Record<string, unknown>) => ({ id: 'p', score: 0.7, payload })
  const PAYLOAD = { id: 'kent_repertory-00002', chapter: 'Mind', text: 'Mind: absent minded', remedies: [['nux', 2]] }

  it('searches the nearest rubrics of every embedding in one request', async () => {
    const fetch = fakeFetch(json({ result: [{ points: [point(PAYLOAD)] }, { points: [] }], status: 'ok' }))

    const found = await rubrics(fetch).search([[0.1], [0.2]], { limit: 3 })

    expect(fetch.calls[0]?.url).toBe('https://qdrant.example/collections/kent_repertory/points/query/batch')
    expect(fetch.calls[0]?.headers['api-key']).toBe('qdrant-key')
    expect(fetch.calls[0]?.body).toEqual({
      searches: [[0.1], [0.2]].map((query) => ({
        query,
        using: 'dense',
        limit: 3,
        with_payload: ['id', 'chapter', 'text', 'remedies'],
        with_vector: false,
      })),
    })
    expect(found).toEqual([[{ id: 'kent_repertory-00002', chapter: 'Mind', text: 'Mind: absent minded', remedies: [['nux', 2]] }], []])
  })

  it('rejects malformed rubrics', async () => {
    const fetch = fakeFetch(json({ result: [{ points: [point({ ...PAYLOAD, remedies: [['nux', 'bold']] })] }] }))

    await expect(rubrics(fetch).search([[0.1]], { limit: 3 })).rejects.toThrow(ProviderError)
  })

  it('reports whether the collection exists', async () => {
    const fetch = fakeFetch(json({ result: { exists: false } }))

    expect(await rubrics(fetch).exists()).toBe(false)
    expect(fetch.calls[0]?.url).toBe('https://qdrant.example/collections/kent_repertory/exists')
  })
})

describe('production retriever with a repertory', () => {
  const embedder = { embedQuery: async () => [1.0] }
  const searching = () => {
    const calls: unknown[] = []
    const corpus: SearchableRelease = {
      corpusVersion: 'local-v1',
      async search(_query, _embedding, options) {
        calls.push(options)
        return []
      },
    }
    return { corpus, calls }
  }
  const repertoryOf = (...remedyIds: string[]): Repertoriser => ({
    repertorise: async () => ({
      symptoms: [],
      remedies: remedyIds.map((remedyId) => ({ remedyId, symptoms: 1, grades: 1 })),
    }),
  })

  it("fuses the repertory's whole ranking with the books' support", async () => {
    const { corpus, calls } = searching()

    await new ProductionRetriever(corpus, embedder, { repertory: repertoryOf('puls', 'sep', 'nat-m') }).retrieve(
      request('A weepy, thirstless woman.'),
      { limit: 8 },
    )

    expect(calls).toEqual([{ limit: 8, priors: [['puls', 'sep', 'nat-m']] }])
  })

  it('searches without a ranking that many remedies lead together at a low score', async () => {
    const { corpus, calls } = searching()

    await new ProductionRetriever(corpus, embedder, { repertory: repertoryOf('puls', 'sep', 'nat-m', 'ign', 'lach') }).retrieve(
      request('A weepy woman.'),
      { limit: 8 },
    )

    expect(calls).toEqual([{ limit: 8, priors: [] }])
  })

  it('searches the whole corpus when the question describes no patient', async () => {
    const { corpus, calls } = searching()

    await new ProductionRetriever(corpus, embedder, { repertory: repertoryOf() }).retrieve(request('What is Sulphur?'), {
      limit: 8,
    })

    expect(calls).toEqual([{ limit: 8, priors: [] }])
  })

  it('searches the whole corpus when repertorisation fails', async () => {
    const { corpus, calls } = searching()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repertory: Repertoriser = {
      repertorise: async () => {
        throw new ProviderError('Z.AI chat request failed with status 500')
      },
    }

    await new ProductionRetriever(corpus, embedder, { repertory }).retrieve(request('A weepy woman.'), { limit: 8 })

    expect(calls).toEqual([{ limit: 8, priors: [] }])
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
  })
})
