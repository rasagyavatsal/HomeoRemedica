/**
 * Hybrid search over the Qdrant materia medica collection.
 *
 * The collection is built by the HomeoRemedica-dataset repository: each chunk has a
 * voyage-4 dense vector and a BM25 sparse vector, and both rankings are fused with
 * reciprocal-rank fusion inside Qdrant. Qdrant encodes the BM25 query itself with the
 * same model that indexed the collection.
 */

import type { BookSummary, RetrievedSource } from './contracts.ts'
import { ProviderError } from './errors.ts'
import { type Fetch, isRecord, readJson, send } from './http.ts'

export const COLLECTION = 'materia_medica'
export const DENSE_VECTOR = 'dense'
export const SPARSE_VECTOR = 'bm25'
export const SPARSE_MODEL = 'qdrant/bm25'
// Each ranking contributes this many candidates per requested source before fusion.
export const PREFETCH_MULTIPLIER = 5
// voyage-4 accepts 32,000 input tokens.
export const MODEL_INPUT_LIMIT = 32_000
export const QDRANT_TIMEOUT_MS = 30_000
const LABEL = 'Qdrant'

// Book IDs are the collection's `source` payload values.
export const BOOKS: readonly BookSummary[] = [
  { bookId: 'allen', title: 'Allen, The Materia Medica of the Nosodes', author: 'H. C. Allen' },
  { bookId: 'boericke', title: 'Boericke, Homoeopathic Materia Medica', author: 'William Boericke' },
  { bookId: 'clarke', title: 'Clarke, A Dictionary of Practical Materia Medica', author: 'John Henry Clarke' },
  { bookId: 'kent', title: 'Kent, Lectures on Homoeopathic Materia Medica', author: 'James Tyler Kent' },
]

/** The Qdrant collection is missing or unreachable. */
export class CorpusError extends Error {
  override name = 'CorpusError'
}

export class QdrantCorpus {
  readonly corpusVersion: string
  readonly modelInputLimit = MODEL_INPUT_LIMIT
  readonly #collectionUrl: string
  readonly #headers: Record<string, string>
  readonly #fetch: Fetch
  readonly #timeoutMs: number

  constructor({
    url,
    apiKey,
    collection = COLLECTION,
    fetch: fetchImpl = fetch,
    timeoutMs = QDRANT_TIMEOUT_MS,
  }: {
    url: string
    apiKey?: string | undefined
    collection?: string
    fetch?: Fetch
    timeoutMs?: number
  }) {
    this.corpusVersion = collection
    this.#collectionUrl = `${url.replace(/\/+$/, '')}/collections/${encodeURIComponent(collection)}`
    this.#headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) }
    this.#fetch = fetchImpl
    this.#timeoutMs = timeoutMs
  }

  async verify(): Promise<void> {
    let exists: unknown
    try {
      const response = await this.#request('/exists', { method: 'GET' })
      const parsed = await readJson(response, LABEL)
      exists = isRecord(parsed) && isRecord(parsed.result) ? parsed.result.exists : undefined
    } catch (error) {
      throw new CorpusError(`could not reach Qdrant: ${error instanceof Error ? error.name : 'error'}`, {
        cause: error,
      })
    }
    if (exists !== true) {
      throw new CorpusError(`Qdrant collection ${JSON.stringify(this.corpusVersion)} does not exist`)
    }
  }

  async search(
    query: string,
    embedding: readonly number[],
    { limit }: { limit: number },
  ): Promise<RetrievedSource[]> {
    const candidates = limit * PREFETCH_MULTIPLIER
    const response = await this.#request('/points/query', {
      method: 'POST',
      body: JSON.stringify({
        prefetch: [
          { query: embedding, using: DENSE_VECTOR, limit: candidates },
          { query: { text: query, model: SPARSE_MODEL }, using: SPARSE_VECTOR, limit: candidates },
        ],
        query: { fusion: 'rrf' },
        limit,
        with_payload: true,
        with_vector: false,
      }),
    })
    const parsed = await readJson(response, LABEL)
    const points = isRecord(parsed) && isRecord(parsed.result) ? parsed.result.points : undefined
    if (!Array.isArray(points)) throw new ProviderError('Qdrant returned no query points')
    return points.map((point) => {
      if (!isRecord(point) || typeof point.score !== 'number') throw new ProviderError('Qdrant returned an invalid point')
      return toSource(isRecord(point.payload) ? point.payload : {}, point.score)
    })
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const response = await send(
      this.#fetch,
      this.#collectionUrl + path,
      { ...init, headers: this.#headers },
      { label: LABEL, timeoutMs: this.#timeoutMs },
    )
    if (!response.ok) throw new ProviderError(`${LABEL} request failed with status ${response.status}`)
    return response
  }
}

function toSource(payload: Record<string, unknown>, score: number): RetrievedSource {
  const group = typeof payload.section_group === 'string' ? payload.section_group : ''
  const sections = (Array.isArray(payload.sections) ? payload.sections : [])
    .filter((section): section is string => typeof section === 'string' && section !== group)
    .join('; ')
  return {
    chunkId: requiredText(payload, 'chunk_id'),
    bookId: requiredText(payload, 'source'),
    bookTitle: requiredText(payload, 'source_title'),
    author: typeof payload.author === 'string' ? payload.author : null,
    remedyName: requiredText(payload, 'remedy'),
    sectionTitle: group && sections ? `${group}: ${sections}` : group || sections,
    passageIndexes: [requiredInteger(payload, 'chunk_index')],
    text: requiredText(payload, 'content'),
    score,
  }
}

function requiredText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  throw new ProviderError(`Qdrant point payload has no ${key}`)
}

function requiredInteger(payload: Record<string, unknown>, key: string): number {
  const value = payload[key]
  if (Number.isInteger(value)) return value as number
  throw new ProviderError(`Qdrant point payload has no integer ${key}`)
}
