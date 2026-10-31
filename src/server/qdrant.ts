/**
 * Hybrid search over the Qdrant materia medica collections, one collection per book.
 *
 * The collections are built by the HomeoRemedica-dataset repository: each chunk has a
 * voyage-4 dense vector and a BM25 sparse vector. Rankings are fused with reciprocal-rank fusion
 * the same way as the dataset's `scripts/search.py`, which its retrieval evaluation measures.
 * Qdrant encodes the BM25 query itself with the same model that indexed the collections.
 */

import type { BookSummary, RetrievedSource } from './contracts.ts'
import { ProviderError } from './errors.ts'
import { type Fetch, isRecord, readJson, send } from './http.ts'

export const CORPUS_VERSION = 'homeoremedica'
export const DENSE_VECTOR = 'dense'
export const SPARSE_VECTOR = 'bm25'
export const SPARSE_MODEL = 'qdrant/bm25'
// Each ranking contributes this many candidates per requested source before fusion.
export const PREFETCH_MULTIPLIER = 5
// The standard reciprocal-rank fusion constant: a ranking adds 1 / (RRF_K + rank) to each point.
export const RRF_K = 60
export const QDRANT_TIMEOUT_MS = 30_000
const LABEL = 'Qdrant'

// Book IDs are the books' Qdrant collection names.
export const BOOKS: readonly BookSummary[] = [
  { bookId: 'allen_keynotes', title: 'Allen, Keynotes and Characteristics', author: 'H. C. Allen' },
  { bookId: 'allen_nosodes', title: 'Allen, The Materia Medica of the Nosodes', author: 'H. C. Allen' },
  { bookId: 'boericke_mm', title: 'Boericke, Homoeopathic Materia Medica', author: 'William Boericke' },
  { bookId: 'clarke_mm', title: 'Clarke, A Dictionary of Practical Materia Medica', author: 'John Henry Clarke' },
  { bookId: 'hahnemann_mm_pura', title: 'Hahnemann, Materia Medica Pura', author: 'Samuel Hahnemann' },
  { bookId: 'hahnemann_organon', title: 'Hahnemann, Organon of Medicine', author: 'Samuel Hahnemann' },
  { bookId: 'kent_lectures', title: 'Kent, Lectures on Homoeopathic Materia Medica', author: 'James Tyler Kent' },
]

/** A Qdrant collection is missing or unreachable. */
export class CorpusError extends Error {
  override name = 'CorpusError'
}

type PointId = string | number

interface Candidate {
  bookId: string
  id: PointId
  score: number
}

export class QdrantCorpus {
  readonly corpusVersion = CORPUS_VERSION
  readonly #baseUrl: string
  readonly #bookIds: readonly string[]
  readonly #headers: Record<string, string>
  readonly #fetch: Fetch
  readonly #timeoutMs: number

  constructor({
    url,
    apiKey,
    bookIds = BOOKS.map((book) => book.bookId),
    fetch: fetchImpl = fetch,
    timeoutMs = QDRANT_TIMEOUT_MS,
  }: {
    url: string
    apiKey?: string | undefined
    bookIds?: readonly string[]
    fetch?: Fetch
    timeoutMs?: number
  }) {
    this.#baseUrl = `${url.replace(/\/+$/, '')}/collections/`
    this.#bookIds = bookIds
    this.#headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) }
    this.#fetch = fetchImpl
    this.#timeoutMs = timeoutMs
  }

  async verify(): Promise<void> {
    const missing: string[] = []
    try {
      await Promise.all(
        this.#bookIds.map(async (bookId) => {
          const parsed = await readJson(await this.#request(bookId, '/exists', { method: 'GET' }), LABEL)
          if (!(isRecord(parsed) && isRecord(parsed.result) && parsed.result.exists === true)) missing.push(bookId)
        }),
      )
    } catch (error) {
      throw new CorpusError(`could not reach Qdrant: ${error instanceof Error ? error.name : 'error'}`, {
        cause: error,
      })
    }
    if (missing.length) {
      throw new CorpusError(`Qdrant collections ${missing.sort().map((name) => JSON.stringify(name)).join(', ')} do not exist`)
    }
  }

  async search(
    query: string,
    embedding: readonly number[],
    { limit }: { limit: number },
  ): Promise<RetrievedSource[]> {
    const candidates = limit * PREFETCH_MULTIPLIER
    const rankings = await Promise.all(
      this.#bookIds.map((bookId) => this.#rank(bookId, query, embedding, candidates)),
    )
    // Dense scores compare across books, so the dense ranking is global. BM25 IDF is per
    // collection, and a small book such as the Organon scores high on everything, so each book
    // keeps its own BM25 ranking.
    const dense = topCandidates(rankings.flatMap(([denseRanking]) => denseRanking), candidates)
    const fused = new Map<string, Candidate>()
    for (const ranking of [dense, ...rankings.map(([, sparseRanking]) => sparseRanking)]) {
      for (const [position, candidate] of ranking.entries()) {
        const key = candidateKey(candidate.bookId, candidate.id)
        const score = (fused.get(key)?.score ?? 0) + 1 / (RRF_K + position + 1)
        fused.set(key, { ...candidate, score })
      }
    }
    const best = topCandidates([...fused.values()], limit)
    const payloads = await this.#payloads(best)
    return best.map((candidate) => {
      const payload = payloads.get(candidateKey(candidate.bookId, candidate.id))
      if (!payload) throw new ProviderError('Qdrant returned no payload for a query point')
      return toSource(candidate.bookId, payload, candidate.score)
    })
  }

  /** One collection's dense and BM25 candidates, best first. */
  async #rank(
    bookId: string,
    query: string,
    embedding: readonly number[],
    limit: number,
  ): Promise<[Candidate[], Candidate[]]> {
    const response = await this.#request(bookId, '/points/query/batch', {
      method: 'POST',
      body: JSON.stringify({
        searches: [
          { query: embedding, using: DENSE_VECTOR, limit, with_payload: false, with_vector: false },
          {
            query: { text: query, model: SPARSE_MODEL },
            using: SPARSE_VECTOR,
            limit,
            with_payload: false,
            with_vector: false,
          },
        ],
      }),
    })
    const parsed = await readJson(response, LABEL)
    const results = isRecord(parsed) ? parsed.result : undefined
    if (!Array.isArray(results) || results.length !== 2) throw new ProviderError('Qdrant returned no query points')
    const [dense, sparse] = results.map((result) => {
      const points = isRecord(result) ? result.points : undefined
      if (!Array.isArray(points)) throw new ProviderError('Qdrant returned no query points')
      return points.map((point) => {
        if (!isRecord(point) || !isPointId(point.id) || typeof point.score !== 'number') {
          throw new ProviderError('Qdrant returned an invalid point')
        }
        return { bookId, id: point.id, score: point.score }
      })
    })
    return [dense!, sparse!]
  }

  /** The payloads of the given points, keyed by `candidateKey`. */
  async #payloads(candidates: readonly Candidate[]): Promise<Map<string, Record<string, unknown>>> {
    const idsByBook = new Map<string, PointId[]>()
    for (const { bookId, id } of candidates) {
      const ids = idsByBook.get(bookId) ?? []
      ids.push(id)
      idsByBook.set(bookId, ids)
    }
    const payloads = new Map<string, Record<string, unknown>>()
    await Promise.all(
      [...idsByBook].map(async ([bookId, ids]) => {
        const response = await this.#request(bookId, '/points', {
          method: 'POST',
          body: JSON.stringify({ ids, with_payload: true, with_vector: false }),
        })
        const parsed = await readJson(response, LABEL)
        const points = isRecord(parsed) ? parsed.result : undefined
        if (!Array.isArray(points)) throw new ProviderError('Qdrant returned no points')
        for (const point of points) {
          if (!isRecord(point) || !isPointId(point.id)) throw new ProviderError('Qdrant returned an invalid point')
          payloads.set(candidateKey(bookId, point.id), isRecord(point.payload) ? point.payload : {})
        }
      }),
    )
    return payloads
  }

  async #request(bookId: string, path: string, init: RequestInit): Promise<Response> {
    const response = await send(
      this.#fetch,
      this.#baseUrl + encodeURIComponent(bookId) + path,
      { ...init, headers: this.#headers },
      { label: LABEL, timeoutMs: this.#timeoutMs },
    )
    if (!response.ok) throw new ProviderError(`${LABEL} request failed with status ${response.status}`)
    return response
  }
}

function topCandidates(candidates: Candidate[], limit: number): Candidate[] {
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit)
}

function candidateKey(bookId: string, id: PointId): string {
  return `${bookId}/${id}`
}

function isPointId(value: unknown): value is PointId {
  return typeof value === 'string' || Number.isInteger(value)
}

function toSource(bookId: string, payload: Record<string, unknown>, score: number): RetrievedSource {
  const group = typeof payload.section_group === 'string' ? payload.section_group : ''
  const sections = [
    ...(Array.isArray(payload.sections) ? payload.sections : []).filter(
      (section): section is string => typeof section === 'string' && section !== group,
    ),
    ...aphorismLabel(payload.aphorisms),
  ].join('; ')
  return {
    chunkId: requiredText(payload, 'chunk_id'),
    bookId,
    bookTitle: requiredText(payload, 'source_title'),
    author: typeof payload.author === 'string' ? payload.author : null,
    // The Organon describes principles, not remedies, so its chunks have none.
    remedyName: typeof payload.remedy === 'string' ? payload.remedy : null,
    sectionTitle: group && sections ? `${group}: ${sections}` : group || sections,
    passageIndexes: [requiredInteger(payload, 'chunk_index')],
    text: requiredText(payload, 'content'),
    score,
  }
}

/** `§ 5` or `§§ 28–29` for the Organon aphorisms a chunk covers. */
function aphorismLabel(value: unknown): string[] {
  const aphorisms = (Array.isArray(value) ? value : []).filter((number) => Number.isInteger(number)) as number[]
  if (!aphorisms.length) return []
  if (aphorisms.length === 1) return [`§ ${aphorisms[0]}`]
  const consecutive = aphorisms.every((number, index) => index === 0 || number === aphorisms[index - 1]! + 1)
  return [`§§ ${consecutive ? `${aphorisms[0]}–${aphorisms.at(-1)}` : aphorisms.join(', ')}`]
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
