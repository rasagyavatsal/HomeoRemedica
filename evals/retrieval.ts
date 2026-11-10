/**
 * Score production's retrieval on its own, without generating answers, so a change to the ranking
 * can be measured against the last run.
 *
 * It asks the cured cases in the HomeoRemedica-private clone (see `cases.ts`), the same ones the
 * answer eval asks. Every case runs through the production retriever: every book searched, with
 * Kent's and Boericke's Repertories' ranking, and Clarke's remedies for the diseases a case names,
 * weighed with the books' support. A case's symptoms are extracted once and kept in
 * .cache/retrieval-symptoms.json, so later runs repertorise the same symptoms; `--fresh` extracts
 * them again. A case's diseases are asked once and kept in .cache/retrieval-diseases.json. A case's
 * rank is the position of the first source on the remedy that cured it; its differential recall is
 * the share of its differential remedies that some source is about.
 *
 * With few cases a difference of one or two is noise, so MRR carries a 95% bootstrap interval over
 * the cases.
 *
 * Where the cured remedy ranks below first, the run says at which step it was lost: it was in
 * neither the dense nor any book's BM25 candidates, one remedy held so much of the results that
 * they were not regrouped, the books and repertories together favoured other remedies, or it was
 * shown but below another. A deeper search, with many more candidates, says how far off a lost
 * remedy was, and the repertories say whether the extracted symptoms point to it at all.
 *
 * Usage: npm run eval:retrieval [-- --fresh] [-- --out results.json]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { ChatRequestSchema, type RetrievedSource } from '../src/server/contracts.ts'
import { CLINICAL_WEIGHT, Clinical, ClinicalTerms, loadClinicalTerms } from '../src/server/clinical.ts'
import { VoyageQueryEmbedder } from '../src/server/embeddings.ts'
import {
  type Candidate,
  DIFFERENTIAL_REMEDIES,
  PREFETCH_MULTIPLIER,
  PRIOR_K,
  PRIOR_WEIGHT,
  QdrantCorpus,
  type SearchStages,
} from '../src/server/qdrant.ts'
import {
  BOERICKE_COLLECTION,
  EXTRACTION_INSTRUCTION,
  REPERTORY_COLLECTION,
  type Repertorisation,
  type Repertoriser,
  type SymptomExtractor,
} from '../src/server/repertory.ts'
import { type QueryEmbedder, ProductionRetriever } from '../src/server/retrieval.ts'
import { loadRepertory, loadSettings, symptomExtractor } from '../src/server/runtime.ts'
import { SOURCE_LIMIT } from '../src/server/service.ts'
import { CASES_PATH, hasPrivateClone, loadCases, remedyIds } from './cases.ts'
import { CachedDiseaseExtractor, DISEASES_CACHE } from './clinical.ts'
import { asker } from './proposals.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CUTOFFS = [1, 3, 5, SOURCE_LIMIT]
const CONCURRENCY = 6
const SYMPTOMS_CACHE = join(ROOT, '.cache', 'retrieval-symptoms.json')
const RESAMPLES = 10_000
/** The deeper search asks each ranking for this many times production's candidates. */
const DEEP_FACTOR = 25
/** The name the results carry, which the unaided eval's `--against` reads. */
const ARM = 'production'

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

/**
 * fetch, retrying a request whose connection dropped, so that one dropped request among the run's
 * hundreds does not end it. A request that timed out is not retried.
 */
async function retryingFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init)
    } catch (error) {
      if (init?.signal?.aborted || attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }
}

/** The result of `run`, tried up to three times, so that a slow provider does not end the run. */
async function retried<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt === 3) throw error
      console.error(`retrying after ${error instanceof Error ? error.message : 'an error'}`)
    }
  }
}

/**
 * Answers a request the same as an identical one made before, so that a search and its stages ask
 * Qdrant once. A failed request is forgotten, so a retry asks again.
 */
function memoizedFetch(fetchImpl: typeof fetch): typeof fetch {
  const responses = new Map<string, Promise<{ status: number; body: string }>>()
  return async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}\n${typeof init?.body === 'string' ? init.body : ''}`
    let response = responses.get(key)
    if (!response) {
      response = fetchImpl(input, init).then(async (answer) => ({ status: answer.status, body: await answer.text() }))
      responses.set(key, response)
      response.catch(() => responses.delete(key))
    }
    const { status, body } = await response
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
  }
}

/** Embeds each query once, for the search and for its stages. */
class CachedEmbedder implements QueryEmbedder {
  readonly #embedder: QueryEmbedder
  readonly #embeddings = new Map<string, Promise<readonly number[]>>()

  constructor(embedder: QueryEmbedder) {
    this.#embedder = embedder
  }

  embedQuery(text: string): Promise<readonly number[]> {
    let embedding = this.#embeddings.get(text)
    if (!embedding) {
      embedding = retried(() => this.#embedder.embedQuery(text))
      this.#embeddings.set(text, embedding)
    }
    return embedding
  }
}

/**
 * Extracts each query's symptoms once and keeps them on disk, keyed by the model, the extraction
 * instruction and the query, so a later run reuses them; `fresh` extracts them again. Times the
 * extractions it makes.
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

/** Repertorises each query once, for the search and for its diagnosis. */
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

function reciprocal(result: Result): number {
  return result.rank ? 1 / result.rank : 0
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

/** A remedy's place among the distinct subjects of a ranking, from 1, or null when it is absent. */
function remedyRank(candidates: readonly Candidate[], remedies: readonly string[]): number | null {
  const wanted = new Set(remedies.map((remedy) => `remedy:${remedy}`))
  const seen = new Set<string>()
  for (const { subject } of candidates) {
    if (seen.has(subject)) continue
    seen.add(subject)
    if (wanted.has(subject)) return seen.size
  }
  return null
}

function bestRank(ranks: readonly (number | null)[]): number | null {
  const present = ranks.filter((rank) => rank !== null)
  return present.length ? Math.min(...present) : null
}

interface Diagnosis {
  id: string
  expected: readonly string[]
  rank: number | null
  /** The cured remedy's place among the remedies of each step, as `remedyRank` gives it. */
  dense: number | null
  sparse: number | null
  fused: number | null
  /**
   * Its place by the books' support weighed with the repertories' ranking, or null when the
   * results were not regrouped.
   */
  support: number | null
  regrouped: boolean
  /** The subject that held the results when they were not regrouped. */
  dominant: string | null
  deep: { dense: number | null; sparse: number | null; fused: number | null }
  repertory: { rank: number | null; covered: number; leader: number; symptoms: number }
}

type Loss = 'not a candidate' | 'not regrouped' | 'outsupported' | 'below another'

function loss(diagnosis: Diagnosis): Loss | null {
  if (diagnosis.rank === 1) return null
  if (diagnosis.fused === null) return 'not a candidate'
  if (!diagnosis.regrouped && diagnosis.rank === null) return 'not regrouped'
  if (diagnosis.rank === null) return 'outsupported'
  return 'below another'
}

const LOSSES: Record<Loss, string> = {
  'not a candidate': `in neither the dense nor any book's BM25 top ${SOURCE_LIMIT * PREFETCH_MULTIPLIER}`,
  'not regrouped': 'a candidate, but one subject held the results so they were not regrouped',
  'outsupported': `a candidate, but not among the ${DIFFERENTIAL_REMEDIES} remedies the books and repertories favour most`,
  'below another': `in the ${SOURCE_LIMIT} sources, below another remedy`,
}

function diagnose(
  item: { id: string; expected: readonly string[] },
  rank: number | null,
  stages: SearchStages,
  deep: SearchStages,
  repertorisation: Repertorisation,
): Diagnosis {
  const ranks = (found: SearchStages) => ({
    dense: remedyRank(found.dense, item.expected),
    sparse: bestRank(found.sparse.map((ranking) => remedyRank(ranking, item.expected))),
    fused: remedyRank(found.fused, item.expected),
  })
  const subjects = new Map<string, number>()
  for (const { subject } of stages.best) subjects.set(subject, (subjects.get(subject) ?? 0) + 1)
  const dominant = stages.support ? null : ([...subjects].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null)
  const supportRank = stages.support?.findIndex((subject) => item.expected.some((remedy) => subject === `remedy:${remedy}`))
  const remedies = repertorisation.remedies
  const cured = remedies.findIndex((remedy) => item.expected.includes(remedy.remedyId))
  return {
    id: item.id,
    expected: item.expected,
    rank,
    ...ranks(stages),
    support: supportRank === undefined || supportRank < 0 ? null : supportRank + 1,
    regrouped: stages.support !== null,
    dominant,
    deep: ranks(deep),
    repertory: {
      rank: cured < 0 ? null : cured + 1,
      covered: cured < 0 ? 0 : remedies[cured]!.symptoms,
      leader: remedies[0]?.symptoms ?? 0,
      symptoms: repertorisation.symptoms.length,
    },
  }
}

function median(values: readonly number[]): string {
  if (!values.length) return '-'
  const sorted = [...values].sort((a, b) => a - b)
  return String(sorted[Math.floor(sorted.length / 2)])
}

function report(diagnoses: readonly Diagnosis[]): void {
  const n = diagnoses.length
  const share = (count: number) => `${String(count).padStart(4)} ${percent(count / n)}`
  const pool = SOURCE_LIMIT * PREFETCH_MULTIPLIER
  const step = (label: string, count: number) => console.log(`  ${label.padEnd(40)}${share(count)}`)
  console.log('\nproduction, step by step: cases whose cured remedy is')
  step(`among the dense top ${pool}`, diagnoses.filter((d) => d.dense !== null).length)
  step(`among some book's BM25 top ${pool}`, diagnoses.filter((d) => d.sparse !== null).length)
  step('a candidate after fusion', diagnoses.filter((d) => d.fused !== null).length)
  step(
    `among the ${DIFFERENTIAL_REMEDIES} most favoured remedies`,
    diagnoses.filter((d) => d.support !== null && d.support <= DIFFERENTIAL_REMEDIES).length,
  )
  step(`in the ${SOURCE_LIMIT} sources`, diagnoses.filter((d) => d.rank !== null).length)
  step('first', diagnoses.filter((d) => d.rank === 1).length)
  console.log(`  (results not regrouped in ${diagnoses.filter((d) => !d.regrouped).length} cases)`)

  console.log('\nwhere production loses the cured remedy')
  for (const [kind, description] of Object.entries(LOSSES)) {
    console.log(`  ${share(diagnoses.filter((d) => loss(d) === kind).length)}  ${description}`)
  }
  const lost = diagnoses.filter((d) => loss(d) === 'not a candidate')
  const deepRanks = (rank: (d: Diagnosis) => number | null) => {
    const ranks = lost.map(rank)
    const present = ranks.filter((value) => value !== null)
    return `median remedy rank ${median(present)}, absent in ${ranks.length - present.length}`
  }
  if (lost.length) {
    console.log(`\n  of the ${lost.length} never a candidate, with ${DEEP_FACTOR} times the candidates:`)
    console.log(`    dense  ${deepRanks((d) => d.deep.dense)}`)
    console.log(`    BM25   ${deepRanks((d) => d.deep.sparse)}`)
    console.log(`    fused  ${deepRanks((d) => d.deep.fused)}`)
  }
  const repertory = diagnoses.map((d) => d.repertory.rank)
  const within = (cutoff: number) => repertory.filter((rank) => rank !== null && rank <= cutoff).length
  console.log(
    `\n  Kent's and Boericke's together rank the cured remedy in their top 10 in ${within(10)} cases, top 20 in ${within(20)}, ` +
      `anywhere in ${within(Infinity)}, of ${n}`,
  )

  console.log(`\n  case by case, remedy ranks at each step (- absent); deep is with ${DEEP_FACTOR} times the candidates`)
  console.log(`    ${'rank'.padStart(4)} ${'dense'.padStart(5)} ${'bm25'.padStart(5)} ${'fused'.padStart(5)} ${'supp'.padStart(5)}  ${'deep d/b/f'.padEnd(14)} ${'repertory'.padEnd(18)} case`)
  const shown = (rank: number | null) => String(rank ?? '-')
  for (const d of diagnoses.filter((diagnosis) => diagnosis.rank !== 1)) {
    const deep = `${shown(d.deep.dense)}/${shown(d.deep.sparse)}/${shown(d.deep.fused)}`
    const repertory = `${shown(d.repertory.rank)} (${d.repertory.covered}/${d.repertory.leader} of ${d.repertory.symptoms})`
    const support = d.regrouped ? shown(d.support) : 'held'
    const note = d.dominant ? `  held by ${d.dominant.replace(/^\w+:/, '')}` : ''
    console.log(
      `    ${shown(d.rank).padStart(4)} ${shown(d.dense).padStart(5)} ${shown(d.sparse).padStart(5)} ${shown(d.fused).padStart(5)} ${support.padStart(5)}  ${deep.padEnd(14)} ${repertory.padEnd(18)} ${d.id}${note}`,
    )
  }
  console.log(`    repertory: rank (symptoms the cured remedy covers / the leader covers of those extracted)`)
}

/** Which cases name a disease, the terms of Clarke's it matches, and where Clarke ranks the cure. */
async function clinicalReport(cases: readonly { id: string; query: string; expected: readonly string[] }[], clinical: Clinical) {
  const rows = await Promise.all(
    cases.map(async ({ id, query, expected }) => {
      const match = await clinical.rank(ChatRequestSchema.parse({ message: query, history: [] }).message)
      const place = match.ranking.findIndex((remedy) => expected.includes(remedy))
      return { id, match, place: place < 0 ? null : place + 1 }
    }),
  )
  const named = rows.filter(({ match }) => match.diseases.length)
  const matched = named.filter(({ match }) => match.terms.length)
  const listed = matched.filter(({ place }) => place !== null)
  console.log(
    `\nClarke's clinical terms: a disease named in ${named.length} of ${cases.length} cases, matching some term in ${matched.length}; ` +
      `the cured remedy listed in ${listed.length}, at median place ${median(listed.map(({ place }) => place!))} of median ${median(matched.map(({ match }) => match.ranking.length))}`,
  )
  for (const { id, match, place } of named) {
    const terms = match.terms.map(({ text, remedies }) => `${text} (${remedies.length})`).join('; ') || 'no term'
    console.log(`  ${String(place ?? '-').padStart(4)}  ${id}: ${match.diseases.join('; ')} -> ${terms}`)
  }
}


async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, fresh: { type: 'boolean', default: false } } })
  if (!hasPrivateClone()) throw new Error(`clone HomeoRemedica-private into private/ so ${CASES_PATH} exists`)
  const settings = loadSettings(process.env, ROOT)
  if (!settings.qdrantUrl) throw new Error('set QDRANT_URL in the environment or .env')

  const cases = loadCases()
  const voyage = new VoyageQueryEmbedder({ apiKey: settings.openrouterApiKey, fetch: retryingFetch, timeoutMs: 90_000 })
  const embedder = new CachedEmbedder(voyage)
  const extractor = new CachedExtractor(symptomExtractor(settings), settings.model, { fresh: values.fresh })
  const repertory = new CachedRepertory(
    await loadRepertory(settings, voyage, { extractor, collections: [REPERTORY_COLLECTION, BOERICKE_COLLECTION] }),
  )
  const diseases = new CachedDiseaseExtractor(settings.model, asker(settings.model))
  const clinical = new Clinical({
    extractor: diseases,
    terms: new ClinicalTerms(await loadClinicalTerms({ url: settings.qdrantUrl, apiKey: settings.qdrantApiKey, fetch: retryingFetch })),
  })
  const corpus = new QdrantCorpus({ url: settings.qdrantUrl, apiKey: settings.qdrantApiKey, fetch: memoizedFetch(retryingFetch) })
  await corpus.verify()
  const retriever = new ProductionRetriever(corpus, embedder, { repertory, prior: true, clinical })
  const diagnoses: Diagnosis[] = []

  const results = await pool(cases, CONCURRENCY, async (item): Promise<Result> => {
    const request = ChatRequestSchema.parse({ message: item.query, history: [] })
    const sources = await retriever.retrieve(request, { limit: SOURCE_LIMIT })
    const remedies = sources.map(remedyOf)
    const first = remedies.findIndex((remedy) => remedy !== null && item.expected.includes(remedy))
    const covered = item.differential.filter((remedy) => remedies.includes(remedy)).length
    const result = {
      arm: ARM,
      id: item.id,
      expected: item.expected,
      rank: first < 0 ? null : first + 1,
      differentialRecall: item.differential.length ? covered / item.differential.length : 1,
      sources: sources.map(sourceName),
    }
    // Production searches the bare message, as a first question with no history, weighing both
    // repertories' ranking and Clarke's with the books' support.
    const [embedding, repertorisation, clinicalMatch] = await Promise.all([
      embedder.embedQuery(request.message),
      repertory.repertorise(request.message),
      clinical.rank(request.message),
    ])
    const ranked = repertorisation.remedies.map((remedy) => remedy.remedyId)
    const prior = ranked.length ? ranked : undefined
    const priors = clinicalMatch.ranking.length ? [{ ranking: clinicalMatch.ranking, weight: CLINICAL_WEIGHT }] : undefined
    const [stages, deep] = await Promise.all([
      corpus.stages(request.message, embedding, { limit: SOURCE_LIMIT, prior, priors }),
      corpus.stages(request.message, embedding, { limit: SOURCE_LIMIT * DEEP_FACTOR, prior, priors }),
    ])
    const staged = stages.best.map(({ subject }) => (subject.startsWith('remedy:') ? subject.slice('remedy:'.length) : null))
    if (JSON.stringify(staged) !== JSON.stringify(remedies)) {
      throw new Error(`${item.id}: the stages do not reproduce production's sources`)
    }
    diagnoses.push(diagnose(item, result.rank, stages, deep, repertorisation))
    return result
  })

  console.log(`${cases.length} cases, ${SOURCE_LIMIT} sources each\n`)
  const header = CUTOFFS.map((cutoff) => `hit@${cutoff}`.padStart(7)).join('')
  console.log(`  ${''.padEnd(15)}${'n'.padStart(5)}${header}${'MRR'.padStart(7)}${'95%'.padStart(11)}${'diff'.padStart(7)}`)
  console.log(`  ${ARM.padEnd(15)}${summary(results)}`)
  console.log('\n95%: bootstrap interval of MRR over the cases')
  console.log('diff: the average share of each case\'s differential remedies that some source is about')
  console.log(
    `${ARM}: every book searched, with Kent's and Boericke's ranking at weight ${PRIOR_WEIGHT} and Clarke's for the diseases a case names ` +
      `at ${CLINICAL_WEIGHT} against the books' support, fused with constant ${PRIOR_K}`,
  )
  if (diseases.reused) console.log(`${settings.model}'s diseases of ${diseases.reused} cases reused from ${DISEASES_CACHE}`)
  if (extractor.reused) {
    console.log(`${settings.model}'s symptoms of ${extractor.reused} cases reused from ${SYMPTOMS_CACHE}; --fresh extracts them again`)
  }
  const seconds = [...extractor.seconds].sort((a, b) => a - b)
  if (seconds.length) {
    const median = seconds[Math.floor(seconds.length / 2)]!
    console.log(`${settings.model}'s symptom extraction took ${median.toFixed(1)} s median, ${seconds.at(-1)!.toFixed(1)} s at most`)
  }

  await clinicalReport(cases, clinical)

  const misses = results.filter((result) => result.rank !== 1)
  console.log(`\n${ARM}: cured remedy not ranked first (${misses.length})`)
  for (const miss of misses) {
    console.log(`  rank=${miss.rank ?? '-'} want=${miss.expected.join(' or ')}  ${miss.id}`)
    console.log(`       got: ${miss.sources.slice(0, 3).join(' | ')}`)
  }

  const order = new Map(cases.map((item, index) => [item.id, index]))
  report(diagnoses.sort((a, b) => order.get(a.id)! - order.get(b.id)!))

  if (values.out) writeFileSync(values.out, JSON.stringify({ results, diagnoses }, null, 1))
}

await main()
