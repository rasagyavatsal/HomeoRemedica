/** voyage-4 query embeddings through OpenRouter. */

import { ConfigurationError, ProviderError, ProviderTimeoutError } from '../shared/errors.ts'
import { type Fetch, isRecord, readJson, send } from '../shared/http.ts'

export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const VOYAGE_EMBEDDING_MODEL = 'voyageai/voyage-4'
export const VOYAGE_DIMENSIONS = 1024

const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const INITIAL_BACKOFF_MS = 1_000
const LABEL = 'OpenRouter embedding'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Embed search queries to match the collection's voyage-4 document vectors. */
export class VoyageQueryEmbedder {
  readonly #url: string
  readonly #headers: Record<string, string>
  readonly #fetch: Fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #timeoutMs: number

  constructor({
    apiKey,
    baseUrl = DEFAULT_OPENROUTER_BASE_URL,
    fetch: fetchImpl = fetch,
    sleep = delay,
    timeoutMs = 30_000,
  }: {
    apiKey: string | undefined
    baseUrl?: string
    fetch?: Fetch
    sleep?: (ms: number) => Promise<void>
    timeoutMs?: number
  }) {
    if (!apiKey) {
      throw new ConfigurationError(
        'an OpenRouter API key is required; set OPENROUTER_API_KEY in the environment or .env',
      )
    }
    this.#url = `${baseUrl.replace(/\/+$/, '')}/embeddings`
    this.#headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    this.#fetch = fetchImpl
    this.#sleep = sleep
    this.#timeoutMs = timeoutMs
  }

  async embedQuery(text: string): Promise<number[]> {
    const body = JSON.stringify({
      model: VOYAGE_EMBEDDING_MODEL,
      input: [text],
      input_type: 'query',
      dimensions: VOYAGE_DIMENSIONS,
      encoding_format: 'float',
    })
    let backoff = INITIAL_BACKOFF_MS
    for (let attempt = 1; ; attempt++) {
      const response = await send(
        this.#fetch,
        this.#url,
        { method: 'POST', headers: this.#headers, body },
        { label: LABEL, timeoutMs: this.#timeoutMs },
      )
      if (response.status === 200) return parseEmbedding(await readJson(response, LABEL))
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_ATTEMPTS) {
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

function parseEmbedding(parsed: unknown): number[] {
  const data = isRecord(parsed) ? parsed.data : undefined
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new ProviderError('OpenRouter did not return exactly one embedding for one input')
  }
  const embedding = data[0].embedding
  if (
    !Array.isArray(embedding) ||
    embedding.length !== VOYAGE_DIMENSIONS ||
    !embedding.every((value) => typeof value === 'number')
  ) {
    throw new ProviderError(`OpenRouter returned an embedding without ${VOYAGE_DIMENSIONS} dimensions`)
  }
  return embedding
}
