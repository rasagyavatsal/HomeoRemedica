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
  distinctMatches,
  leadingRemedies,
  parseSymptoms,
  rankRemedies,
  standingOut,
} from '../src/server/repertory.ts'
import { ProductionRetriever, type SearchableRelease } from '../src/server/retrieval.ts'
import { fakeFetch, json } from './fakes.ts'

const rubric = (text: string, ...remedies: [string, number][]): Rubric => ({
  id: text,
  bookId: 'kent_repertory',
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

describe('distinctMatches', () => {
  it('counts a rubric under the first symptom that matched it and drops a symptom left with none', () => {
    const sciatica = rubric('Extremities: pain, sciatica', ['coloc', 3])
    const night = rubric('Extremities: pain, sciatica, night', ['ars', 2])
    const matches = [
      { symptom: 'Extremities: sciatica', rubrics: [sciatica] },
      { symptom: 'Extremities: sciatic pain', rubrics: [sciatica] },
      { symptom: 'Extremities: sciatica, worse at night', rubrics: [night, sciatica] },
      { symptom: 'Extremities: sciatica', rubrics: [{ ...sciatica, bookId: 'boericke_repertory' }] },
    ]

    const distinct = distinctMatches(matches)

    expect(distinct.map(({ symptom, rubrics }) => [symptom, rubrics.map((found) => found.bookId + ' ' + found.id)])).toEqual([
      ['Extremities: sciatica', ['kent_repertory Extremities: pain, sciatica']],
      ['Extremities: sciatica, worse at night', ['kent_repertory Extremities: pain, sciatica, night']],
      ['Extremities: sciatica', ['boericke_repertory Extremities: pain, sciatica']],
    ])
    expect(rankRemedies(distinct)[0]).toEqual({ remedyId: 'coloc', symptoms: 2, grades: 6 })
  })
})

describe('standingOut', () => {
  const scored = (...scores: [symptoms: number, grades: number][]) =>
    scores.map(([symptoms, grades], index) => ({ remedyId: `remedy-${index}`, symptoms, grades }))
  const ids = (...scores: [number, number][]) => standingOut(scored(...scores), 3).map((remedy) => remedy.remedyId)

  it('gives the first remedies when the next one scores lower, or there is none', () => {
    expect(ids([4, 9], [3, 6], [3, 5], [3, 4])).toEqual(['remedy-0', 'remedy-1', 'remedy-2'])
    expect(ids([4, 9], [3, 6])).toEqual(['remedy-0', 'remedy-1'])
    expect(ids([2, 4], [2, 4], [2, 4])).toEqual(['remedy-0', 'remedy-1', 'remedy-2'])
  })

  it('leaves out the remedies that score the same as one past the limit', () => {
    expect(ids([4, 9], [3, 6], [3, 5], [3, 5])).toEqual(['remedy-0', 'remedy-1'])
    expect(ids([4, 9], [3, 5], [3, 5], [3, 5], [3, 5])).toEqual(['remedy-0'])
    expect(ids([3, 5], [3, 5], [3, 5], [3, 5])).toEqual([])
  })
})

describe('leadingRemedies', () => {
  const matches = [
    {
      symptom: 'Mind: weeps easily',
      rubrics: [rubric('Mind: weeping', ['pulsatilla', 3], ['natrum-muriaticum', 2]), rubric('Mind: weeping, alone', ['natrum-muriaticum', 3])],
    },
    { symptom: 'Stomach: no thirst', rubrics: [rubric('Stomach: thirstless', ['pulsatilla', 3], ['gelsemium', 2])] },
  ]
  const repertorisation = { symptoms: matches, remedies: rankRemedies(matches) }

  it('gives the first remedies with their symptoms and the rubric that grades each highest', () => {
    const { remedies, rubrics } = leadingRemedies(repertorisation, { firstSource: 6, limit: 2 })

    expect(remedies).toEqual([
      { remedyName: 'Pulsatilla', matched: [{ text: 'Mind: weeps easily', source: 6 }, { text: 'Stomach: no thirst', source: 8 }] },
      { remedyName: 'Natrum muriaticum', matched: [{ text: 'Mind: weeps easily', source: 7 }] },
    ])
    expect(rubrics.map((source) => [source.bookTitle, source.sectionTitle, source.text])).toEqual([
      ['Kent, Repertory of the Homoeopathic Materia Medica', 'Mind: weeping', 'Remedies and their grades: Pulsatilla (3), Natrum muriaticum (2)'],
      ['Kent, Repertory of the Homoeopathic Materia Medica', 'Mind: weeping, alone', 'Remedies and their grades: Natrum muriaticum (3)'],
      ['Kent, Repertory of the Homoeopathic Materia Medica', 'Stomach: thirstless', 'Remedies and their grades: Pulsatilla (3), Gelsemium (2)'],
    ])
    expect(rubrics[0]).toMatchObject({ chunkId: 'Mind: weeping', bookId: 'kent_repertory', remedyName: null, passageIndexes: [] })
  })

  it('names three remedies and cites no more rubrics than it may', () => {
    const { remedies, rubrics } = leadingRemedies(repertorisation, { firstSource: 1, maxRubrics: 1 })

    expect(remedies.map((remedy) => remedy.remedyName)).toEqual(['Pulsatilla', 'Natrum muriaticum', 'Gelsemium'])
    expect(remedies[1]?.matched).toEqual([{ text: 'Mind: weeps easily' }])
    expect(rubrics).toHaveLength(1)
  })

  it('names no remedy that ties with one it leaves out', () => {
    const tied = [{ symptom: 'Mind: anxious', rubrics: [rubric('Mind: anxiety', ['aconitum', 3], ['apis', 1], ['arsenicum', 1], ['mezereum', 1], ['thuja', 1])] }]

    const { remedies, rubrics } = leadingRemedies({ symptoms: tied, remedies: rankRemedies(tied) }, { firstSource: 1 })

    expect(remedies.map((remedy) => remedy.remedyName)).toEqual(['Aconitum'])
    expect(rubrics[0]?.text).toBe('Remedies and their grades: Aconitum (3), Apis (1), Arsenicum (1), Mezereum (1), Thuja (1)')
  })

  it("lists the leading remedies first in a long rubric's source, then the rest by grade", () => {
    const many = Array.from({ length: 45 }, (_, index): [string, number] => [`remedy-${index}`, index === 44 ? 3 : 1])
    const long = [{ symptom: 'Mind: anxious', rubrics: [rubric('Mind: anxiety', ...many, ['sulphur', 1])] }]

    const { rubrics } = leadingRemedies(
      { symptoms: long, remedies: [{ remedyId: 'sulphur', symptoms: 1, grades: 1 }] },
      { firstSource: 1 },
    )

    expect(rubrics[0]?.text).toMatch(/^Remedies and their grades: Sulphur \(1\), Remedy 44 \(3\), Remedy 0 \(1\), .*, and 6 more$/)
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
    expect(parseSymptoms(Array.from({ length: 20 }, (_, index) => `Head: pain ${index}`).join('\n'))).toHaveLength(MAX_SYMPTOMS)
  })

  it('keeps a symptom the reply repeats once', () => {
    expect(parseSymptoms('Head: pain, morning\nSleep: restless\nhead: Pain, morning')).toEqual(['Head: pain, morning', 'Sleep: restless'])
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

  it('ranks by the symptoms it is given without reading the case', async () => {
    const extractSymptoms = vi.fn(async () => ['Mind: weeping'])
    const embedded: (readonly string[])[] = []
    const repertory = new Repertory({
      extractor: { extractSymptoms },
      embedder: {
        async embedQueries(texts) {
          embedded.push(texts)
          return texts.map(() => [0])
        },
      },
      rubrics: { search: async () => [[rubric('Stomach: thirstless', ['puls', 2])]] },
    })

    const result = await repertory.repertorise('case', ['Stomach: thirstless'])

    expect(extractSymptoms).not.toHaveBeenCalled()
    expect(embedded).toEqual([['Stomach: thirstless']])
    expect(result.remedies.map((remedy) => remedy.remedyId)).toEqual(['puls'])
    expect(await repertory.repertorise('case', [])).toEqual({ symptoms: [], remedies: [] })
    expect(await repertory.symptoms('case')).toEqual(['Mind: weeping'])
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
    expect(found).toEqual([[{ id: 'kent_repertory-00002', bookId: 'kent_repertory', chapter: 'Mind', text: 'Mind: absent minded', remedies: [['nux', 2]] }], []])
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
      async search(_query, _embedding, options) {
        calls.push(options)
        return []
      },
    }
    return { corpus, calls }
  }
  const repertoryOf = (...remedyIds: string[]): Repertoriser => ({
    symptoms: async () => [],
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

  it('returns the leading remedies and their rubrics after the passages', async () => {
    const passage = { chunkId: 'chk_1', bookId: 'kent_lectures', bookTitle: "Kent's Lectures", author: null, remedyName: 'PULSATILLA', sectionTitle: 'MIND', passageIndexes: [1], text: 'Weeps.', score: 0.03 }
    const corpus: SearchableRelease = { search: async () => [passage] }
    const symptoms = [{ symptom: 'Mind: weeps easily', rubrics: [rubric('Mind: weeping', ['pulsatilla', 3])] }]
    const repertory: Repertoriser = {
      symptoms: async () => [],
      repertorise: async () => ({ symptoms, remedies: rankRemedies(symptoms) }),
    }

    const retrieval = await new ProductionRetriever(corpus, embedder, { repertory }).retrieve(request('A weepy woman.'), { limit: 5 })

    expect(retrieval.sources.map((source) => source.chunkId)).toEqual(['chk_1', 'Mind: weeping'])
    expect(retrieval.repertory).toEqual([{ remedyName: 'Pulsatilla', matched: [{ text: 'Mind: weeps easily', source: 2 }] }])
    expect(retrieval.clinical).toEqual([])
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

  it('reads symptoms from, and ranks by, the questions the search uses', async () => {
    const { corpus } = searching()
    const seen: unknown[] = []
    const repertory: Repertoriser = {
      symptoms: async (text) => (seen.push(text), ['Mind: weeping']),
      repertorise: async (text, symptoms) => (seen.push([text, symptoms]), { symptoms: [], remedies: [] }),
    }
    const retriever = new ProductionRetriever(corpus, embedder, { repertory })
    const asked = ChatRequestSchema.parse({
      message: 'She is thirstless.',
      history: [{ role: 'user', content: 'A weepy woman.' }, { role: 'assistant', content: 'Pulsatilla.' }],
      symptoms: ['Stomach: thirstless'],
    })

    expect(await retriever.symptoms(asked)).toEqual(['Mind: weeping'])
    await retriever.retrieve(asked, { limit: 8 })

    const query = 'A weepy woman.\nShe is thirstless.'
    expect(seen).toEqual([query, [query, ['Stomach: thirstless']]])
    expect(await new ProductionRetriever(corpus, embedder).symptoms(asked)).toEqual([])
  })

  it('searches the whole corpus when repertorisation fails', async () => {
    const { corpus, calls } = searching()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repertory: Repertoriser = {
      symptoms: async () => [],
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
