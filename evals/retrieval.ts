/**
 * Score retrieval on its own, without generating answers, so a change to the ranking can be
 * measured against the current one.
 *
 * It asks the cured cases in the HomeoRemedica-private clone (see `cases.ts`), the same ones the
 * answer eval asks. Every case runs through the production retriever once per arm. A case's
 * symptoms are extracted once and kept in .cache/retrieval-symptoms.json, so every arm and every
 * later run repertorises the same symptoms and differs only in how it searches; `--fresh`
 * extracts them again. A case's rank is the position of the first source on the remedy that cured
 * it; its differential recall is the share of its differential remedies that some source is about.
 *
 * With few cases a difference of one or two is noise, so MRR carries a 95% bootstrap interval over
 * the cases, and every arm is compared with production on the same cases: a paired bootstrap
 * interval of the difference and a sign test on which ranks it improves. A baseline that ignores the
 * query and returns the remedies with the most passages shows how much a score owes to the cures
 * being well-documented remedies.
 *
 * Usage: npm run eval:retrieval [-- --fresh] [-- --out results.json]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { ChatRequestSchema, type RetrievedSource, type Retriever } from '../src/server/contracts.ts'
import { VoyageQueryEmbedder } from '../src/server/embeddings.ts'
import { QdrantCorpus } from '../src/server/qdrant.ts'
import {
  EXTRACTION_INSTRUCTION,
  type Repertorisation,
  type Repertoriser,
  type SymptomExtractor,
} from '../src/server/repertory.ts'
import { type QueryEmbedder, ProductionRetriever } from '../src/server/retrieval.ts'
import { loadRepertory, loadSettings, symptomExtractor } from '../src/server/runtime.ts'
import { SOURCE_LIMIT } from '../src/server/service.ts'
import { CASES_PATH, hasPrivateClone, loadCases, remedyIds } from './cases.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CUTOFFS = [1, 3, 5, SOURCE_LIMIT]
const CONCURRENCY = 6
const SYMPTOMS_CACHE = join(ROOT, '.cache', 'retrieval-symptoms.json')
const RESAMPLES = 10_000
const BASELINE = 'popular'

/**
 * Ways of searching: whether the fused candidates are regrouped by remedy, from how many of the
 * repertory's leading remedies a described case's passages come, if any, whether those remedies
 * keep the repertory's order. The first is production's and is reported in detail.
 */
const ARMS = [
  { name: 'production', regroup: true, candidates: null, remedyOrder: false },
  { name: 'fusion only', regroup: false, candidates: null, remedyOrder: false },
  { name: 'repertory 20', regroup: true, candidates: 20, remedyOrder: false },
  { name: 'repertory 10', regroup: true, candidates: 10, remedyOrder: false },
  { name: 'rep. order 8', regroup: true, candidates: 8, remedyOrder: true },
  { name: 'rep. order 20', regroup: true, candidates: 20, remedyOrder: true },
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

/**
 * Extracts each query's symptoms once and keeps them on disk, keyed by the model, the extraction
 * instruction and the query, so a later run reuses them. Times the extractions it makes.
 */
class CachedExtractor implements SymptomExtractor {
  readonly #extractor: SymptomExtractor
  readonly #model: string
  readonly #stored: Record<string, string[]>
  readonly #results = new Map<string, Promise<string[]>>()
  readonly seconds: number[] = []
  reused = 0

  constructor(extractor: SymptomExtractor, model: string, { fresh }: { fresh: boolean }) {
    this.#extractor = extractor
    this.#model = model
    this.#stored = !fresh && existsSync(SYMPTOMS_CACHE) ? JSON.parse(readFileSync(SYMPTOMS_CACHE, 'utf8')) : {}
  }

  extractSymptoms(text: string): Promise<string[]> {
    const key = createHash('sha256').update(`${this.#model}\n${EXTRACTION_INSTRUCTION}\n${text}`).digest('hex')
    let result = this.#results.get(key)
    if (!result) {
      result = this.#extract(key, text)
      this.#results.set(key, result)
    }
    return result
  }

  async #extract(key: string, text: string): Promise<string[]> {
    const stored = this.#stored[key]
    if (stored) {
      this.reused++
      return stored
    }
    const start = performance.now()
    const symptoms = await this.#extractor.extractSymptoms(text)
    this.seconds.push((performance.now() - start) / 1000)
    this.#stored[key] = symptoms
    mkdirSync(dirname(SYMPTOMS_CACHE), { recursive: true })
    writeFileSync(SYMPTOMS_CACHE, JSON.stringify(this.#stored, null, 1))
    return symptoms
  }
}

/** Repertorises each query once, however many arms search with it. */
class CachedRepertory implements Repertoriser {
  readonly #repertory: Repertoriser
  readonly #results = new Map<string, Promise<Repertorisation>>()

  constructor(repertory: Repertoriser) {
    this.#repertory = repertory
  }

  repertorise(text: string): Promise<Repertorisation> {
    let result = this.#results.get(text)
    if (!result) {
      result = this.#repertory.repertorise(text)
      this.#results.set(text, result)
    }
    return result
  }
}

/**
 * The baseline: whatever the query, one passage each on the remedies with the most passages in the
 * corpus, which are the most fully proved and the most prescribed.
 */
class PopularRemedies implements Retriever {
  readonly corpusVersion = BASELINE
  readonly #sources: RetrievedSource[]

  constructor() {
    const passages = new Map<string, string[]>()
    for (const [chunkId, remedy] of remedyIds()) {
      if (remedy) passages.set(remedy, [...(passages.get(remedy) ?? []), chunkId])
    }
    this.#sources = [...passages.entries()]
      .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
      .map(([remedy, [chunkId]]) => ({
        chunkId: chunkId!,
        bookId: BASELINE,
        bookTitle: BASELINE,
        author: null,
        remedyName: remedy,
        sectionTitle: remedy,
        passageIndexes: [],
        text: '',
        score: 0,
      }))
  }

  async retrieve(_request: unknown, { limit }: { limit: number }): Promise<readonly RetrievedSource[]> {
    return this.#sources.slice(0, limit)
  }
}

/** A seeded generator, so a run's intervals are the same every time it is repeated. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The 95% percentile bootstrap interval of the mean of `values`, resampling the cases. */
function interval(values: readonly number[]): [number, number] {
  const next = random(1)
  const means = Array.from({ length: RESAMPLES }, () => {
    let sum = 0
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(next() * values.length)]!
    return sum / values.length
  }).sort((a, b) => a - b)
  return [means[Math.floor(0.025 * RESAMPLES)]!, means[Math.floor(0.975 * RESAMPLES)]!]
}

/** The two-sided exact sign test's p-value for `better` improvements against `worse` regressions. */
function signTest(better: number, worse: number): number {
  const n = better + worse
  let tail = 0
  let choose = 1
  for (let k = 0; k <= Math.min(better, worse); k++) {
    tail += choose
    choose = (choose * (n - k)) / (k + 1)
  }
  return Math.min(1, (2 * tail) / 2 ** n)
}

function reciprocal(result: Result): number {
  return result.rank ? 1 / result.rank : 0
}

function found(result: Result): number {
  return result.rank === null ? 0 : 1
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
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
  const reciprocals = results.map(reciprocal)
  const mrr = reciprocals.reduce((sum, value) => sum + value, 0) / reciprocals.length
  const [low, high] = interval(reciprocals)
  const recall = results.reduce((sum, result) => sum + result.differentialRecall, 0) / results.length
  const range = `${low.toFixed(2)}–${high.toFixed(2)}`
  return `${String(results.length).padStart(5)}${hits.join('')}${mrr.toFixed(3).padStart(7)}${range.padStart(11)}${percent(recall)}`
}

/** How `other` differs from `base` on the same cases, in MRR, in hit@SOURCE_LIMIT and case by case. */
function comparison(base: readonly Result[], other: readonly Result[]): string {
  const differences = (score: (result: Result) => number) => other.map((result, index) => score(result) - score(base[index]!))
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const described = (values: readonly number[], scale: number, digits: number, unit: string) => {
    const [low, high] = interval(values)
    const shown = (value: number) => `${signed(scale * value, digits)}${unit}`
    return `${shown(mean(values))} (${shown(low)} to ${shown(high)})`
  }
  const rank = (result: Result) => result.rank ?? Infinity
  const better = other.filter((result, index) => rank(result) < rank(base[index]!)).length
  const worse = other.filter((result, index) => rank(result) > rank(base[index]!)).length
  return (
    `MRR ${described(differences(reciprocal), 1, 3, '')}, hit@${SOURCE_LIMIT} ${described(differences(found), 100, 0, '%')}; ` +
    `better ${better}, worse ${worse}, same ${other.length - better - worse}, sign test p=${signTest(better, worse).toFixed(2)}`
  )
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, fresh: { type: 'boolean', default: false } } })
  if (!hasPrivateClone()) throw new Error(`clone HomeoRemedica-private into private/ so ${CASES_PATH} exists`)
  const settings = loadSettings(process.env, ROOT)
  if (!settings.qdrantUrl) throw new Error('set QDRANT_URL in the environment or .env')

  const cases = loadCases()
  const voyage = new VoyageQueryEmbedder({ apiKey: settings.openrouterApiKey })
  const embedder = new CachedEmbedder(voyage)
  const extractor = new CachedExtractor(symptomExtractor(settings), settings.model, { fresh: values.fresh })
  const repertory = new CachedRepertory(await loadRepertory(settings, voyage, { extractor }))
  const arms: { name: string; retriever: Retriever }[] = ARMS.map((arm) => ({
    name: arm.name,
    retriever: new ProductionRetriever(
        new QdrantCorpus({
          url: settings.qdrantUrl!,
          apiKey: settings.qdrantApiKey,
          regroup: arm.regroup,
          remedyOrder: arm.remedyOrder,
        }),
        embedder,
      arm.candidates ? { repertory, candidates: arm.candidates } : {},
    ),
  }))
  arms.push({ name: BASELINE, retriever: new PopularRemedies() })
  await new QdrantCorpus({ url: settings.qdrantUrl, apiKey: settings.qdrantApiKey }).verify()

  const results = (
    await pool(cases, CONCURRENCY, async (item) => {
      const request = ChatRequestSchema.parse({ message: item.query, history: [] })
      const scored: Result[] = []
      for (const arm of arms) {
        const sources = await arm.retriever.retrieve(request, { limit: SOURCE_LIMIT })
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
  console.log(`  ${''.padEnd(15)}${'n'.padStart(5)}${header}${'MRR'.padStart(7)}${'95%'.padStart(11)}${'diff'.padStart(7)}`)
  for (const arm of arms) {
    console.log(`  ${arm.name.padEnd(15)}${summary(results.filter((result) => result.arm === arm.name))}`)
  }
  console.log('\n95%: bootstrap interval of MRR over the cases')
  console.log('diff: the average share of each case\'s differential remedies that some source is about')
  console.log(`${BASELINE}: the ${SOURCE_LIMIT} remedies with the most passages, whatever the query`)
  const seconds = [...extractor.seconds].sort((a, b) => a - b)
  if (extractor.reused) console.log(`symptoms of ${extractor.reused} cases reused from ${SYMPTOMS_CACHE}; --fresh extracts them again`)
  if (seconds.length) {
    const median = seconds[Math.floor(seconds.length / 2)]!
    console.log(`symptom extraction took ${median.toFixed(1)} s median, ${seconds.at(-1)!.toFixed(1)} s at most`)
  }

  const [production, ...others] = arms.map((arm) => results.filter((result) => result.arm === arm.name))
  console.log(`\nagainst ${arms[0]!.name} on the same cases, with 95% paired bootstrap intervals`)
  for (const [offset, other] of others.entries()) {
    console.log(`  ${arms[offset + 1]!.name.padEnd(15)}${comparison(production!, other)}`)
  }

  const misses = production!.filter((result) => result.rank !== 1)
  console.log(`\n${arms[0]!.name}: cured remedy not ranked first (${misses.length})`)
  for (const miss of misses) {
    console.log(`  rank=${miss.rank ?? '-'} want=${miss.expected.join(' or ')}  ${miss.id}`)
    console.log(`       got: ${miss.sources.slice(0, 3).join(' | ')}`)
  }
  for (const [offset, other] of others.entries()) {
    const changed = other.flatMap((result, index) => {
      const before = production![index]!.rank
      return result.rank === before ? [] : [`  ${String(before ?? '-').padStart(2)} -> ${String(result.rank ?? '-').padEnd(2)}  ${result.id}`]
    })
    console.log(`\n${arms[offset + 1]!.name}: ranked differently from ${arms[0]!.name} (${changed.length})`)
    for (const line of changed) console.log(line)
  }

  if (values.out) writeFileSync(values.out, JSON.stringify(results, null, 1))
}

await main()
