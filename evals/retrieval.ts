/**
 * Score retrieval on its own, without generating answers, so a change to the ranking can be
 * measured against the current one.
 *
 * Questions come from two places:
 * - the `tests.yaml` cases that name an expected `remedy` or `book`, written as practitioners
 *   type them, follow-ups included;
 * - when the HomeoRemedica-private clone is present, its labelled `eval/questions.jsonl`, scored
 *   against the remedy ids and Organon aphorisms in its `chunks/`. Those stay in that clone.
 *
 * Every question runs through the production retriever once per arm. A question's rank is the
 * position of the first source that meets any of its expectations; `all@k` counts the questions
 * whose sources meet every expectation, which is what a differential of several remedies needs.
 *
 * Usage: npm run eval:retrieval [-- --out results.json]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { parse } from 'yaml'

import { ChatRequestSchema, type RetrievedSource } from '../src/server/contracts.ts'
import { VoyageQueryEmbedder } from '../src/server/embeddings.ts'
import { BOOKS, QdrantCorpus } from '../src/server/qdrant.ts'
import { type QueryEmbedder, ProductionRetriever } from '../src/server/retrieval.ts'
import { loadSettings } from '../src/server/runtime.ts'
import { SOURCE_LIMIT } from '../src/server/service.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CASES = join(ROOT, 'evals', 'tests.yaml')
const PRIVATE_QUESTIONS = join(ROOT, 'private', 'eval', 'questions.jsonl')
const PRIVATE_CHUNKS = join(ROOT, 'private', 'chunks')
const ORGANON = 'hahnemann_organon'
const CUTOFFS = [1, 3, 5, SOURCE_LIMIT]
const CONCURRENCY = 6

/** Ways of ordering the fused candidates. The first is production's and is reported in detail. */
const ARMS = [
  { name: 'production', regroup: true },
  { name: 'fusion only', regroup: false },
] as const

interface Expectation {
  label: string
  met(source: RetrievedSource): boolean
}

interface Question {
  set: 'cases' | 'private'
  label: string
  message: string
  history: unknown
  /** The books to search, or every book. */
  books: readonly string[] | undefined
  expected: readonly Expectation[]
}

interface Result {
  arm: string
  set: Question['set']
  label: string
  want: string[]
  /** Position of the first source meeting any expectation, from 1, or null. */
  rank: number | null
  /** Whether the sources meet every expectation. */
  all: boolean
  sources: string[]
}

function caseQuestions(): Question[] {
  const tests = parse(readFileSync(CASES, 'utf8')) as { description: string; vars: Record<string, unknown> }[]
  return tests.flatMap(({ description, vars }) => {
    const expected: Expectation[] = []
    if (typeof vars.remedy === 'string') {
      for (const stem of vars.remedy.toLowerCase().split('|').map((part) => part.trim()).filter(Boolean)) {
        expected.push({ label: stem, met: (source) => Boolean(source.remedyName?.toLowerCase().includes(stem)) })
      }
    }
    if (typeof vars.book === 'string') {
      const book = vars.book
      expected.push({ label: book, met: (source) => source.bookId === book })
    }
    if (!expected.length) return []
    const history = typeof vars.history === 'string' ? JSON.parse(vars.history) : []
    return [{ set: 'cases', label: description, message: String(vars.query), history, books: undefined, expected }]
  })
}

interface ChunkLabel {
  remedyId: string | null
  aphorisms: readonly number[]
}

/** Remedy ids and aphorisms by chunk id, read from the private clone's chunk files. */
function chunkLabels(): Map<string, ChunkLabel> {
  const labels = new Map<string, ChunkLabel>()
  for (const name of readdirSync(PRIVATE_CHUNKS).filter((file) => file.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(PRIVATE_CHUNKS, name), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { id: string; remedy_id?: string | null; aphorisms?: number[] | null }
      labels.set(chunk.id, { remedyId: chunk.remedy_id ?? null, aphorisms: chunk.aphorisms ?? [] })
    }
  }
  return labels
}

function privateQuestions(): Question[] {
  const labels = chunkLabels()
  const remedyIds = new Set([...labels.values()].map((label) => label.remedyId))
  const lines = readFileSync(PRIVATE_QUESTIONS, 'utf8').split('\n').filter((line) => line.trim())
  return lines.map((line, index) => {
    const question = JSON.parse(line) as { q: string; remedy?: string[]; aphorisms?: number[]; book?: string[] }
    const label = (source: RetrievedSource) => labels.get(source.chunkId)
    let expectation: Expectation
    if (question.aphorisms) {
      const wanted = new Set(question.aphorisms)
      expectation = {
        label: `§ ${question.aphorisms.join(', ')}`,
        met: (source) => source.bookId === ORGANON && Boolean(label(source)?.aphorisms.some((number) => wanted.has(number))),
      }
    } else {
      const wanted = new Set(question.remedy ?? [])
      const unknown = [...wanted].filter((id) => !remedyIds.has(id))
      if (!wanted.size || unknown.length) {
        throw new Error(`${PRIVATE_QUESTIONS}:${index + 1}: no chunk has remedy id ${unknown.join(', ') || '(none given)'}`)
      }
      expectation = { label: [...wanted].join(' or '), met: (source) => wanted.has(label(source)?.remedyId ?? '') }
    }
    return {
      set: 'private',
      label: question.q,
      message: question.q,
      history: [],
      books: question.book,
      expected: [expectation],
    }
  })
}

/** Embeds each query once, however many arms search with it. */
class CachedEmbedder implements QueryEmbedder {
  readonly #embedder: QueryEmbedder
  readonly #embeddings = new Map<string, Promise<readonly number[]>>()

  constructor(embedder: QueryEmbedder) {
    this.#embedder = embedder
  }

  embedQuery(text: string): Promise<readonly number[]> {
    let embedding = this.#embeddings.get(text)
    if (!embedding) {
      embedding = this.#embedder.embedQuery(text)
      this.#embeddings.set(text, embedding)
    }
    return embedding
  }
}

async function pool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await run(items[index]!)
      }
    }),
  )
  return results
}

function sourceName(source: RetrievedSource): string {
  return `${source.bookId} ${source.remedyName ?? source.sectionTitle}`
}

function percent(count: number, total: number): string {
  return `${Math.round((100 * count) / total)}%`.padStart(7)
}

function summary(label: string, results: readonly Result[]): string {
  const ranks = results.map((result) => result.rank)
  const hits = CUTOFFS.map((cutoff) => percent(ranks.filter((rank) => rank !== null && rank <= cutoff).length, ranks.length))
  const mrr = ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length
  const all = percent(results.filter((result) => result.all).length, results.length)
  return `  ${label.padEnd(10)}${String(results.length).padStart(5)}${hits.join('')}${mrr.toFixed(3).padStart(7)}${all}`
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  const settings = loadSettings(process.env, ROOT)
  if (!settings.qdrantUrl) throw new Error('set QDRANT_URL in the environment or .env')

  const questions = caseQuestions()
  if (existsSync(PRIVATE_QUESTIONS) && existsSync(PRIVATE_CHUNKS)) {
    questions.push(...privateQuestions())
  } else {
    console.log('The private clone is missing, so only the tests.yaml cases are scored.\n')
  }

  const embedder = new CachedEmbedder(new VoyageQueryEmbedder({ apiKey: settings.openrouterApiKey }))
  const retrievers = new Map<string, ProductionRetriever>()
  const retriever = (regroup: boolean, books: readonly string[] | undefined) => {
    const key = `${regroup}:${books?.join(',') ?? ''}`
    let found = retrievers.get(key)
    if (!found) {
      const corpus = new QdrantCorpus({
        url: settings.qdrantUrl!,
        apiKey: settings.qdrantApiKey,
        bookIds: books ?? BOOKS.map((book) => book.bookId),
        regroup,
      })
      found = new ProductionRetriever(corpus, embedder)
      retrievers.set(key, found)
    }
    return found
  }
  await new QdrantCorpus({ url: settings.qdrantUrl, apiKey: settings.qdrantApiKey }).verify()

  const results = (
    await pool(questions, CONCURRENCY, async (question) => {
      const request = ChatRequestSchema.parse({ message: question.message, history: question.history })
      const scored: Result[] = []
      for (const arm of ARMS) {
        const sources = await retriever(arm.regroup, question.books).retrieve(request, { limit: SOURCE_LIMIT })
        const index = sources.findIndex((source) => question.expected.some((expected) => expected.met(source)))
        scored.push({
          arm: arm.name,
          set: question.set,
          label: question.label,
          want: question.expected.map((expected) => expected.label),
          rank: index < 0 ? null : index + 1,
          all: question.expected.every((expected) => sources.some((source) => expected.met(source))),
          sources: sources.map(sourceName),
        })
      }
      return scored
    })
  ).flat()

  console.log(`${questions.length} questions, ${SOURCE_LIMIT} sources each\n`)
  console.log(`  ${''.padEnd(10)}${'n'.padStart(5)}${CUTOFFS.map((cutoff) => `hit@${cutoff}`.padStart(7)).join('')}${'MRR'.padStart(7)}${`all@${SOURCE_LIMIT}`.padStart(7)}`)
  for (const arm of ARMS) {
    const armResults = results.filter((result) => result.arm === arm.name)
    console.log(arm.name)
    for (const set of ['cases', 'private'] as const) {
      const setResults = armResults.filter((result) => result.set === set)
      if (setResults.length) console.log(summary(set, setResults))
    }
    console.log(summary('all', armResults))
  }

  const [production, ...others] = ARMS.map((arm) => results.filter((result) => result.arm === arm.name))
  const misses = production!.filter((result) => result.rank !== 1 || !result.all)
  console.log(`\n${ARMS[0].name}: not ranked first or missing an expectation (${misses.length})`)
  for (const miss of misses) {
    console.log(`  rank=${miss.rank ?? '-'} want=${miss.want.join(', ')}  ${miss.label.slice(0, 70)}`)
    console.log(`       got: ${miss.sources.slice(0, 3).join(' | ')}`)
  }
  for (const [offset, other] of others.entries()) {
    const changed = other.flatMap((result, index) => {
      const before = production![index]!.rank
      return result.rank === before ? [] : [`  ${String(before ?? '-').padStart(2)} -> ${String(result.rank ?? '-').padEnd(2)}  ${result.label.slice(0, 70)}`]
    })
    console.log(`\n${ARMS[offset + 1]!.name}: ranked differently from ${ARMS[0].name} (${changed.length})`)
    for (const line of changed) console.log(line)
  }

  if (values.out) writeFileSync(values.out, JSON.stringify(results, null, 1))
}

await main()
