import { describe, expect, it, vi } from 'vitest'

import {
  Clinical,
  type ClinicalRanker,
  ClinicalTerms,
  DISEASE_INSTRUCTION,
  ModelDiseaseExtractor,
  loadClinicalTerms,
  parseDiseases,
  termWords,
} from '../src/server/clinical.ts'
import { ChatRequestSchema } from '../src/server/contracts.ts'
import { ProviderError } from '../src/server/errors.ts'
import type { Repertoriser } from '../src/server/repertory.ts'
import { ProductionRetriever, type SearchableRelease } from '../src/server/retrieval.ts'
import { fakeFetch, json } from './fakes.ts'

describe('termWords', () => {
  it('ignores spelling, plurals, linking words and order', () => {
    expect(termWords('Diarrhœa of infants')).toEqual(termWords('infant diarrhoea'))
    expect(termWords('Pains in rectum')).toEqual(new Set(['pain', 'rectum']))
  })
})

describe('parseDiseases', () => {
  it('keeps the Disease lines', () => {
    expect(parseDiseases('Disease: bronchial asthma\n- disease: Eczema\nThe patient is anxious.')).toEqual([
      'bronchial asthma',
      'Eczema',
    ])
    expect(parseDiseases('NONE')).toEqual([])
  })
})

describe('ClinicalTerms', () => {
  const terms = new ClinicalTerms([
    { text: 'asthma', remedies: ['ars', 'ip', 'nat-s', 'sulph'] },
    { text: 'asthma, bronchial', remedies: ['nat-s'] },
    { text: 'eczema', remedies: ['graph', 'sulph'] },
    { text: 'hay fever', remedies: ['sabad'] },
  ])

  it('matches every term whose words are all among the disease', () => {
    expect(terms.match(['Bronchial asthma']).terms.map((term) => term.text)).toEqual(['asthma', 'asthma, bronchial'])
    expect(terms.match(['fever']).terms).toEqual([])
  })

  it('ranks remedies by terms matched, then by how few remedies the terms list', () => {
    // Natrum sulph. is in both asthma terms; Sulphur, also in eczema, is in two terms of all four.
    expect(terms.match(['bronchial asthma']).ranking).toEqual(['nat-s', 'sulph', 'ars', 'ip'])
    expect(terms.match(['asthma', 'eczema']).ranking).toEqual(['sulph', 'graph', 'nat-s', 'ars', 'ip'])
  })
})

describe('ModelDiseaseExtractor', () => {
  it('asks the model for the case in tags with the disease instruction', async () => {
    const asked: [string, unknown][] = []
    const generator = {
      model: 'glm-5.3-flash',
      async generate(prompt: string, options?: { systemInstruction?: string }) {
        asked.push([prompt, options?.systemInstruction])
        return 'Disease: sciatica'
      },
      async *stream() {},
    }

    expect(await new ModelDiseaseExtractor(generator).extractDiseases('Left sciatica, better walking.')).toEqual(['sciatica'])
    expect(asked).toEqual([['<case>\nLeft sciatica, better walking.\n</case>', DISEASE_INSTRUCTION]])
  })
})

describe('loadClinicalTerms', () => {
  it('reads every page of the collection', async () => {
    const point = (path: string[], ...remedies: string[]) => ({ id: 1, payload: { path, remedies: remedies.map((r) => [r, 1]) } })
    const fetch = fakeFetch(
      json({ result: { points: [point(['asthma', 'bronchial'], 'nat-s')], next_page_offset: 7 } }),
      json({ result: { points: [point(['sciatica'], 'gnaph', 'coloc')], next_page_offset: null } }),
    )

    const terms = await loadClinicalTerms({ url: 'https://qdrant.example/', apiKey: 'qdrant-key', fetch })

    expect(terms).toEqual([
      { text: 'asthma, bronchial', remedies: ['nat-s'] },
      { text: 'sciatica', remedies: ['gnaph', 'coloc'] },
    ])
    expect(fetch.calls[0]?.url).toBe('https://qdrant.example/collections/clarke_clinical/points/scroll')
    expect(fetch.calls[0]?.headers['api-key']).toBe('qdrant-key')
    expect(fetch.calls.map((call) => (call.body as { offset: unknown }).offset)).toEqual([null, 7])
  })

  it('rejects malformed terms', async () => {
    const fetch = fakeFetch(json({ result: { points: [{ id: 1, payload: { path: ['asthma'], remedies: [[3, 1]] } }] } }))

    await expect(loadClinicalTerms({ url: 'https://qdrant.example', fetch })).rejects.toThrow(ProviderError)
  })
})

describe('production retriever with Clarke', () => {
  const embedder = { embedQuery: async () => [1.0] }
  const request = (message: string) => ChatRequestSchema.parse({ message })
  const repertory: Repertoriser = {
    repertorise: async () => ({ symptoms: [], remedies: [{ remedyId: 'puls', symptoms: 1, grades: 1 }] }),
  }
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
  const clinical = new Clinical({
    extractor: { extractDiseases: async () => ['sciatica'] },
    terms: new ClinicalTerms([{ text: 'sciatica', remedies: ['gnaph', 'coloc'] }]),
  })

  it("weighs Clarke's ranking beside the repertory's", async () => {
    const { corpus, calls } = searching()

    await new ProductionRetriever(corpus, embedder, { repertory, prior: true, clinical, clinicalWeight: 0.25 }).retrieve(
      request('Left sciatica, better walking.'),
      { limit: 8 },
    )

    expect(calls).toEqual([{ limit: 8, prior: ['puls'], priors: [{ ranking: ['coloc', 'gnaph'], weight: 0.25 }] }])
  })

  it('searches without Clarke when the case names no disease he lists, or matching fails', async () => {
    const { corpus, calls } = searching()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const none = new Clinical({ extractor: { extractDiseases: async () => [] }, terms: new ClinicalTerms([]) })
    const failing: ClinicalRanker = {
      rank: async () => {
        throw new ProviderError('Z.AI chat request failed with status 500')
      },
    }

    for (const ranker of [none, failing]) {
      await new ProductionRetriever(corpus, embedder, { repertory, prior: true, clinical: ranker }).retrieve(request('A weepy woman.'), {
        limit: 8,
      })
    }

    expect(calls).toEqual([
      { limit: 8, prior: ['puls'], priors: undefined },
      { limit: 8, prior: ['puls'], priors: undefined },
    ])
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
  })
})
