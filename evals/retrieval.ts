/**
 * Score retrieval on its own, without generating answers, so a change to the ranking can be
 * measured against the current one.
 *
 * It asks the cured cases in the HomeoRemedica-private clone (see `cases.ts`), the same ones the
 * answer eval asks. Every case runs through the production retriever once per arm; each case is
 * repertorised once, however many arms use it. A case's rank
 * is the position of the first source on the remedy that cured it; its differential recall is the
 * share of its differential remedies that some source is about.
 *
 * Usage: npm run eval:retrieval [-- --out results.json]
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { ChatRequestSchema, type RetrievedSource } from '../src/server/contracts.ts'
import { VoyageQueryEmbedder } from '../src/server/embeddings.ts'
import { QdrantCorpus } from '../src/server/qdrant.ts'
import type { Repertorisation, Repertoriser } from '../src/server/repertory.ts'
import { type QueryEmbedder, ProductionRetriever } from '../src/server/retrieval.ts'
import { loadRepertory, loadSettings } from '../src/server/runtime.ts'
import { SOURCE_LIMIT } from '../src/server/service.ts'
import { CASES_PATH, hasPrivateClone, loadCases, remedyIds } from './cases.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CUTOFFS = [1, 3, 5, SOURCE_LIMIT]
const CONCURRENCY = 6

/**
 * Ways of searching: whether the fused candidates are regrouped by remedy, and from how many of
 * the repertory's leading remedies a described case's passages come, if any. The first is
 * production's and is reported in detail.
 */
const ARMS = [
  { name: 'production', regroup: true, candidates: null },
  { name: 'fusion only', regroup: false, candidates: null },
  { name: 'repertory 20', regroup: true, candidates: 20 },
  { name: 'repertory 10', regroup: true, candidates: 10 },
] as const

interface Result {
  arm: string
  id: string
  expected: readonly string[]
  /** Position of the first source on an expected remedy, from 1, or null. */
  rank: number | null
  /** Share of the differential remedies some source is about. */
  differentialRecall: number
  sources: string[]
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

/** Repertorises each query once, however many arms search with it, and times it. */
class CachedRepertory implements Repertoriser {
  readonly #repertory: Repertoriser
  readonly #results = new Map<string, Promise<Repertorisation>>()
  readonly seconds: number[] = []

  constructor(repertory: Repertoriser) {
    this.#repertory = repertory
  }

  repertorise(text: string): Promise<Repertorisation> {
    let result = this.#results.get(text)
    if (!result) {
      const start = performance.now()
      result = this.#repertory.repertorise(text).then((value) => {
        this.seconds.push((performance.now() - start) / 1000)
        return value
      })
      this.#results.set(text, result)
    }
    return result
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

function remedyOf(source: RetrievedSource): string | null {
  return remedyIds().get(source.chunkId) ?? null
}

function sourceName(source: RetrievedSource): string {
  return `${source.bookId} ${remedyOf(source) ?? source.sectionTitle}`
}

function percent(fraction: number): string {
  return `${Math.round(100 * fraction)}%`.padStart(7)
}

function summary(results: readonly Result[]): string {
  const ranks = results.map((result) => result.rank)
  const hits = CUTOFFS.map((cutoff) => percent(ranks.filter((rank) => rank !== null && rank <= cutoff).length / ranks.length))
  const mrr = ranks.reduce<number>((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / ranks.length
  const recall = results.reduce((sum, result) => sum + result.differentialRecall, 0) / results.length
  return `${String(results.length).padStart(5)}${hits.join('')}${mrr.toFixed(3).padStart(7)}${percent(recall)}`
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' } } })
  if (!hasPrivateClone()) throw new Error(`clone HomeoRemedica-private into private/ so ${CASES_PATH} exists`)
  const settings = loadSettings(process.env, ROOT)
  if (!settings.qdrantUrl) throw new Error('set QDRANT_URL in the environment or .env')

  const cases = loadCases()
  const voyage = new VoyageQueryEmbedder({ apiKey: settings.openrouterApiKey })
  const embedder = new CachedEmbedder(voyage)
  const repertory = new CachedRepertory(await loadRepertory(settings, voyage))
  const retrievers = ARMS.map(
    (arm) =>
      new ProductionRetriever(
        new QdrantCorpus({ url: settings.qdrantUrl!, apiKey: settings.qdrantApiKey, regroup: arm.regroup }),
        embedder,
        arm.candidates ? { repertory, candidates: arm.candidates } : {},
      ),
  )
  await new QdrantCorpus({ url: settings.qdrantUrl, apiKey: settings.qdrantApiKey }).verify()

  const results = (
    await pool(cases, CONCURRENCY, async (item) => {
      const request = ChatRequestSchema.parse({ message: item.query, history: [] })
      const scored: Result[] = []
      for (const [index, arm] of ARMS.entries()) {
        const sources = await retrievers[index]!.retrieve(request, { limit: SOURCE_LIMIT })
        const remedies = sources.map(remedyOf)
        const first = remedies.findIndex((remedy) => remedy !== null && item.expected.includes(remedy))
        const covered = item.differential.filter((remedy) => remedies.includes(remedy)).length
        scored.push({
          arm: arm.name,
          id: item.id,
          expected: item.expected,
          rank: first < 0 ? null : first + 1,
          differentialRecall: item.differential.length ? covered / item.differential.length : 1,
          sources: sources.map(sourceName),
        })
      }
      return scored
    })
  ).flat()

  console.log(`${cases.length} cases, ${SOURCE_LIMIT} sources each\n`)
  const header = CUTOFFS.map((cutoff) => `hit@${cutoff}`.padStart(7)).join('')
  console.log(`  ${''.padEnd(12)}${'n'.padStart(5)}${header}${'MRR'.padStart(7)}${'diff'.padStart(7)}`)
  for (const arm of ARMS) {
    console.log(`  ${arm.name.padEnd(12)}${summary(results.filter((result) => result.arm === arm.name))}`)
  }
  console.log('\ndiff: the average share of each case\'s differential remedies that some source is about')
  const seconds = [...repertory.seconds].sort((a, b) => a - b)
  if (seconds.length) {
    const median = seconds[Math.floor(seconds.length / 2)]!
    console.log(`repertorisation took ${median.toFixed(1)} s median, ${seconds.at(-1)!.toFixed(1)} s at most`)
  }

  const [production, ...others] = ARMS.map((arm) => results.filter((result) => result.arm === arm.name))
  const misses = production!.filter((result) => result.rank !== 1)
  console.log(`\n${ARMS[0].name}: cured remedy not ranked first (${misses.length})`)
  for (const miss of misses) {
    console.log(`  rank=${miss.rank ?? '-'} want=${miss.expected.join(' or ')}  ${miss.id}`)
    console.log(`       got: ${miss.sources.slice(0, 3).join(' | ')}`)
  }
  for (const [offset, other] of others.entries()) {
    const changed = other.flatMap((result, index) => {
      const before = production![index]!.rank
      return result.rank === before ? [] : [`  ${String(before ?? '-').padStart(2)} -> ${String(result.rank ?? '-').padEnd(2)}  ${result.id}`]
    })
    console.log(`\n${ARMS[offset + 1]!.name}: ranked differently from ${ARMS[0].name} (${changed.length})`)
    for (const line of changed) console.log(line)
  }

  if (values.out) writeFileSync(values.out, JSON.stringify(results, null, 1))
}

await main()
