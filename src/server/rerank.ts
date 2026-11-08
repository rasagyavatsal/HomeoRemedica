/** Cross-encoder reranking of passages through OpenRouter. */

import { DEFAULT_OPENROUTER_BASE_URL } from './embeddings.ts'
import { ConfigurationError, ProviderError, ProviderTimeoutError } from './errors.ts'
import { type Fetch, isRecord, readJson, send } from './http.ts'

export const RERANK_MODEL = 'voyageai/rerank-2.5'

const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])
const LABEL = 'OpenRouter rerank'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface PassageReranker {
  /** Each passage's relevance to the query, in the passages' order. */
  rerank(query: string, passages: readonly string[]): Promise<number[]>
}

export class OpenRouterReranker implements PassageReranker {
  readonly #url: string
  readonly #headers: Record<string, string>
  readonly #model: string
  readonly #fetch: Fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #timeoutMs: number
  readonly #attempts: number
  readonly #backoffMs: number

  constructor({
    apiKey,
    model = RERANK_MODEL,
    baseUrl = DEFAULT_OPENROUTER_BASE_URL,
    fetch: fetchImpl = fetch,
    sleep = delay,
    timeoutMs = 30_000,
    attempts = 3,
    backoffMs = 1_000,
  }: {
    apiKey: string | undefined
    model?: string
    baseUrl?: string
    fetch?: Fetch
    sleep?: (ms: number) => Promise<void>
    timeoutMs?: number
    /** How many times a request is sent before a transient failure is raised. */
    attempts?: number
    /** The wait before the first retry, doubled before each later one. */
    backoffMs?: number
  }) {
    if (!apiKey) {
      throw new ConfigurationError('an OpenRouter API key is required; set OPENROUTER_API_KEY in the environment or .env')
    }
    this.#url = `${baseUrl.replace(/\/+$/, '')}/rerank`
    this.#headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    this.#model = model
    this.#fetch = fetchImpl
    this.#sleep = sleep
    this.#timeoutMs = timeoutMs
    this.#attempts = attempts
    this.#backoffMs = backoffMs
  }

  async rerank(query: string, passages: readonly string[]): Promise<number[]> {
    if (!passages.length) return []
    const body = JSON.stringify({ model: this.#model, query, documents: passages, top_n: passages.length })
    let backoff = this.#backoffMs
    for (let attempt = 1; ; attempt++) {
      let response: Response
      try {
        response = await send(
          this.#fetch,
          this.#url,
          { method: 'POST', headers: this.#headers, body },
          { label: LABEL, timeoutMs: this.#timeoutMs },
        )
      } catch (error) {
        // A dropped connection is retried like a transient status; a timeout is not.
        if (error instanceof ProviderTimeoutError || attempt === this.#attempts) throw error
        await this.#sleep(backoff)
        backoff *= 2
        continue
      }
      if (response.status === 200) return parseScores(await readJson(response, LABEL), passages.length)
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === this.#attempts) {
        if (response.status === 408 || response.status === 504) {
          throw new ProviderTimeoutError(`${LABEL} request timed out`)
        }
        throw new ProviderError(`${LABEL} request failed with status ${response.status}`)
      }
      await this.#sleep(backoff)
      backoff *= 2
    }
  }
}

/** The results come best first, each with its passage's index; this puts them back in order. */
function parseScores(parsed: unknown, count: number): number[] {
  const results = isRecord(parsed) ? parsed.results : undefined
  if (!Array.isArray(results) || results.length !== count) {
    throw new ProviderError('OpenRouter did not return one rerank score per passage')
  }
  const scores: (number | undefined)[] = Array.from({ length: count }, () => undefined)
  for (const result of results) {
    const index = isRecord(result) ? result.index : undefined
    const score = isRecord(result) ? result.relevance_score : undefined
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= count || typeof score !== 'number') {
      throw new ProviderError('OpenRouter returned an invalid rerank result')
    }
    scores[index as number] = score
  }
  if (scores.some((score) => score === undefined)) {
    throw new ProviderError('OpenRouter did not return one rerank score per passage')
  }
  return scores as number[]
}
