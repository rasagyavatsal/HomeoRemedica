/**
 * Hybrid search over the Qdrant materia medica collections, one collection per book.
 *
 * The collections are built by the HomeoRemedica-private repository: each chunk has a
 * voyage-4 dense vector and a BM25 sparse vector. Rankings are fused with reciprocal-rank fusion
 * the same way as that repository's `scripts/search.py`, which its retrieval evaluation measures.
 * Qdrant encodes the BM25 query itself with the same model that indexed the collections.
 *
 * Unlike `scripts/search.py`, results that no remedy dominates are regrouped by remedy: a
 * question that describes symptoms rather than naming a remedy gets the remedies most books
 * support, instead of passages that each match well in only one book.
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
// Results are regrouped by remedy unless one remedy, or one book without remedies, holds this share.
export const DOMINANT_SHARE = 0.5
// Regrouped results start with the best passage of each of this many remedies.
export const DIFFERENTIAL_REMEDIES = 5
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

export interface Candidate {
  bookId: string
  id: PointId
  score: number
  /** The passage's remedy as `remedy:<id>`, or its book as `book:<id>` when it has none, such as an Organon passage. */
  subject: string
}

/** What a search found at each step, so an evaluation can see where a remedy was lost. */
export interface SearchStages {
  /** The dense candidates of all books together, best first. */
  dense: readonly Candidate[]
  /** Each book's BM25 candidates, best first. */
  sparse: readonly (readonly Candidate[])[]
  /** Both rankings fused, best first. */
  fused: readonly Candidate[]
  /** Subjects by the books' support, best first, when the fused results were regrouped; otherwise null. */
  support: readonly string[] | null
  /** The candidates the search returns. */
  best: readonly Candidate[]
}

export class QdrantCorpus {
  readonly corpusVersion = CORPUS_VERSION
  readonly #baseUrl: string
  readonly #bookIds: readonly string[]
  readonly #headers: Record<string, string>
  readonly #fetch: Fetch
  readonly #timeoutMs: number
  readonly #regroup: boolean
  readonly #remedyOrder: boolean

  constructor({
    url,
    apiKey,
    bookIds = BOOKS.map((book) => book.bookId),
    fetch: fetchImpl = fetch,
    timeoutMs = QDRANT_TIMEOUT_MS,
    regroup = true,
    remedyOrder = false,
  }: {
    url: string
    apiKey?: string | undefined
    bookIds?: readonly string[]
    fetch?: Fetch
    timeoutMs?: number
    /** Whether results that no remedy dominates are regrouped by remedy; false keeps the fused order. */
    regroup?: boolean
    /**
     * Whether a search narrowed to given remedies shows the best passage of each in the order
     * given, rather than regrouping them by the books' support.
     */
    remedyOrder?: boolean
  }) {
    this.#baseUrl = `${url.replace(/\/+$/, '')}/collections/`
    this.#bookIds = bookIds
    this.#headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) }
    this.#fetch = fetchImpl
    this.#timeoutMs = timeoutMs
    this.#regroup = regroup
    this.#remedyOrder = remedyOrder
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

  /** The best `limit` passages, from only the given remedies' passages when `remedies` is set. */
  async search(
    query: string,
    embedding: readonly number[],
    options: { limit: number; remedies?: readonly string[] | undefined },
  ): Promise<RetrievedSource[]> {
    const { best } = await this.stages(query, embedding, options)
    const payloads = await this.#payloads(best)
    return best.map((candidate) => {
      const payload = payloads.get(candidateKey(candidate.bookId, candidate.id))
      if (!payload) throw new ProviderError('Qdrant returned no payload for a query point')
      return toSource(candidate.bookId, payload, candidate.score)
    })
  }

  /** The candidates `search` ranks at each step, without fetching the passages. */
  async stages(
    query: string,
    embedding: readonly number[],
    { limit, remedies }: { limit: number; remedies?: readonly string[] | undefined },
  ): Promise<SearchStages> {
    const candidates = limit * PREFETCH_MULTIPLIER
    const rankings = await Promise.all(
      this.#bookIds.map((bookId) => this.#rank(bookId, query, embedding, candidates, remedies)),
    )
    // Dense scores compare across books, so the dense ranking is global. BM25 IDF is per
    // collection, and a small book such as the Organon scores high on everything, so each book
    // keeps its own BM25 ranking.
    const dense = topCandidates(rankings.flatMap(([denseRanking]) => denseRanking), candidates)
    const sparse = rankings.map(([, sparseRanking]) => sparseRanking)
    const fused = new Map<string, Candidate>()
    for (const ranking of [dense, ...sparse]) {
      for (const [position, candidate] of ranking.entries()) {
        const key = candidateKey(candidate.bookId, candidate.id)
        const score = (fused.get(key)?.score ?? 0) + 1 / (RRF_K + position + 1)
        fused.set(key, { ...candidate, score })
      }
    }
    const ranked = topCandidates([...fused.values()], fused.size)
    const found = { dense, sparse, fused: ranked }
    if (remedies && this.#remedyOrder) return { ...found, support: null, best: inRemedyOrder(ranked, remedies, limit) }
    if (!this.#regroup || dominated(ranked, limit)) return { ...found, support: null, best: ranked.slice(0, limit) }
    const support = bySupport(ranked)
    return { ...found, support, best: select(ranked, support, limit) }
  }

  /** One collection's dense and BM25 candidates, best first. */
  async #rank(
    bookId: string,
    query: string,
    embedding: readonly number[],
    limit: number,
    remedies: readonly string[] | undefined,
  ): Promise<[Candidate[], Candidate[]]> {
    const filter = remedies ? { filter: { must: [{ key: 'remedy_id', match: { any: remedies } }] } } : {}
    const response = await this.#request(bookId, '/points/query/batch', {
      method: 'POST',
      body: JSON.stringify({
        searches: [
          { query: embedding, using: DENSE_VECTOR, limit, ...filter, with_payload: ['remedy_id'], with_vector: false },
          {
            query: { text: query, model: SPARSE_MODEL },
            using: SPARSE_VECTOR,
            limit,
            ...filter,
            with_payload: ['remedy_id'],
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
        const remedyId = isRecord(point.payload) ? point.payload.remedy_id : undefined
        const subject = typeof remedyId === 'string' ? `remedy:${remedyId}` : `book:${bookId}`
        return { bookId, id: point.id, score: point.score, subject }
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

/**
 * Whether one subject holds enough of the best `limit` candidates that the question is about it,
 * such as a question that names a remedy, so the fused order stands.
 */
function dominated(ranked: readonly Candidate[], limit: number): boolean {
  const counts = new Map<string, number>()
  for (const { subject } of ranked.slice(0, limit)) counts.set(subject, (counts.get(subject) ?? 0) + 1)
  return Math.max(0, ...counts.values()) >= limit * DOMINANT_SHARE
}

/**
 * Subjects by how well the books together support them, best first. A subject's support sums its
 * best passage in each book, so agreement between books outweighs many passages from one, such as
 * the long symptom lists of the provings and the nosodes.
 */
function bySupport(ranked: readonly Candidate[]): string[] {
  const counted = new Set<string>()
  const support = new Map<string, number>()
  for (const { subject, bookId, score } of ranked) {
    if (counted.has(candidateKey(bookId, subject))) continue
    counted.add(candidateKey(bookId, subject))
    support.set(subject, (support.get(subject) ?? 0) + score)
  }
  return [...support.keys()].sort((a, b) => support.get(b)! - support.get(a)!)
}

/**
 * The best `limit` of the ranked candidates when no subject dominates them: the question describes
 * symptoms rather than naming a remedy, so the best passage of each of the best-supported remedies
 * comes first, then more of theirs.
 */
function select(ranked: readonly Candidate[], support: readonly string[], limit: number): Candidate[] {
  const leaders = new Set(support.slice(0, DIFFERENTIAL_REMEDIES))
  const firsts = [...leaders].map((subject) => ranked.find((candidate) => candidate.subject === subject)!)
  const rest = ranked.filter((candidate) => leaders.has(candidate.subject) && !firsts.includes(candidate))
  return [...firsts, ...rest].slice(0, limit)
}

/** The best passage of each remedy in the given order, then the rest by score. */
function inRemedyOrder(ranked: readonly Candidate[], remedies: readonly string[], limit: number): Candidate[] {
  const firsts = remedies
    .map((remedy) => ranked.find((candidate) => candidate.subject === `remedy:${remedy}`))
    .filter((candidate) => candidate !== undefined)
    .slice(0, limit)
  return [...firsts, ...ranked.filter((candidate) => !firsts.includes(candidate))].slice(0, limit)
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
