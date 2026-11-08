import { describe, expect, it } from 'vitest'

import { ProviderTimeoutError } from '../src/server/errors.ts'
import { OpenRouterReranker } from '../src/server/rerank.ts'
import { fakeFetch, json, timeout } from './fakes.ts'

describe('OpenRouter reranker', () => {
  const reranker = (fetch: ReturnType<typeof fakeFetch>) =>
    new OpenRouterReranker({ apiKey: 'key', fetch, sleep: async () => {} })

  it('scores passages in their order and retries transient failures', async () => {
    const fetch = fakeFetch(
      json({}, 429),
      json({
        results: [
          { index: 1, relevance_score: 0.9, document: { text: 'b' } },
          { index: 0, relevance_score: 0.2, document: { text: 'a' } },
        ],
      }),
    )

    expect(await reranker(fetch).rerank('question', ['a', 'b'])).toEqual([0.2, 0.9])
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[0]?.url).toBe('https://openrouter.ai/api/v1/rerank')
    expect(fetch.calls[0]?.headers.Authorization).toBe('Bearer key')
    expect(fetch.calls[0]?.body).toEqual({
      model: 'voyageai/rerank-2.5',
      query: 'question',
      documents: ['a', 'b'],
      top_n: 2,
    })
  })

  it('asks nothing for no passages', async () => {
    const fetch = fakeFetch()

    expect(await reranker(fetch).rerank('question', [])).toEqual([])
    expect(fetch.calls).toHaveLength(0)
  })

  it('rejects results that do not score every passage once', async () => {
    const twice = json({ results: [{ index: 0, relevance_score: 0.5 }, { index: 0, relevance_score: 0.4 }] })
    const short = json({ results: [{ index: 0, relevance_score: 0.5 }] })

    await expect(reranker(fakeFetch(twice)).rerank('q', ['a', 'b'])).rejects.toThrow(/one rerank score per passage/)
    await expect(reranker(fakeFetch(short)).rerank('q', ['a', 'b'])).rejects.toThrow(/one rerank score per passage/)
  })

  it('retries a dropped connection', async () => {
    const fetch = fakeFetch(new TypeError('fetch failed'), json({ results: [{ index: 0, relevance_score: 0.5 }] }))

    expect(await reranker(fetch).rerank('q', ['a'])).toEqual([0.5])
    expect(fetch.calls).toHaveLength(2)
  })

  it('gives up after three attempts', async () => {
    const fetch = fakeFetch(json({}, 503), json({}, 503), json({}, 503))

    await expect(reranker(fetch).rerank('q', ['a'])).rejects.toThrow(/status 503/)
    expect(fetch.calls).toHaveLength(3)
  })

  it('classifies timeouts without exposing details', async () => {
    const error = await reranker(fakeFetch(timeout()))
      .rerank('q', ['a'])
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ProviderTimeoutError)
    expect(String(error)).not.toContain('timeout secret')
  })

  it('requires a key', () => {
    expect(() => new OpenRouterReranker({ apiKey: undefined })).toThrow(/OPENROUTER_API_KEY/)
  })
})
