/**
 * Ask Claude to name each cured case's remedy from the case alone, without retrieval, to see how
 * far the case text points to the remedy that cured it.
 *
 * Retrieval puts the cured remedy among its first five in about four cases in ten however it ranks
 * remedies. If Claude unaided does much better, the cases point to their remedies and retrieval is
 * what falls short; if it does no better, the cases are mostly beyond what the text supports. The
 * cases are published ones Claude may have read, so it is also asked whether it recognises each,
 * and the scores are given apart for the cases it says it does not.
 *
 * A Claude model runs through the Claude Code CLI on its signed-in subscription, a `vendor/model`
 * through OpenRouter, so a model that did not write the cases can read them, and any other is
 * asked through Z.AI like production's answer model, so `--model glm-5.3-flash` shows whether that
 * model could propose a case's remedies itself. Replies are kept as `proposals.ts` keeps them.
 *
 * Usage: npm run eval:unaided [-- --model glm-5.3-flash | openai/gpt-6.1-sol] [-- --against retrieval-results.json]
 */

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { CASES_PATH, hasPrivateClone, loadCases } from './cases.ts'
import { PROPOSED_REMEDIES, Proposer } from './proposals.ts'

const DEFAULT_MODEL = 'claude-opus-5-5'
const CUTOFFS = [1, 3, 5, 10]
const CONCURRENCY = 4
const RESAMPLES = 10_000

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

/** The 95% percentile bootstrap interval of the mean of `values`, from a seeded generator. */
function interval(values: readonly number[]): [number, number] {
  let seed = 1
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const means = Array.from({ length: RESAMPLES }, () => {
    let sum = 0
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(next() * values.length)]!
    return sum / values.length
  }).sort((a, b) => a - b)
  return [means[Math.floor(0.025 * RESAMPLES)]!, means[Math.floor(0.975 * RESAMPLES)]!]
}

function summary(label: string, ranks: readonly (number | null)[]): string {
  if (!ranks.length) return `  ${label.padEnd(22)}${'0'.padStart(5)}`
  const hits = CUTOFFS.map((cutoff) => `${Math.round((100 * ranks.filter((rank) => rank !== null && rank <= cutoff).length) / ranks.length)}%`.padStart(7))
  const reciprocals = ranks.map((rank) => (rank ? 1 / rank : 0))
  const mrr = reciprocals.reduce((sum, value) => sum + value, 0) / reciprocals.length
  const [low, high] = interval(reciprocals)
  return `  ${label.padEnd(22)}${String(ranks.length).padStart(5)}${hits.join('')}${mrr.toFixed(3).padStart(7)}${`${low.toFixed(2)}–${high.toFixed(2)}`.padStart(11)}`
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { model: { type: 'string', default: DEFAULT_MODEL }, against: { type: 'string' } } })
  if (!hasPrivateClone()) throw new Error(`clone HomeoRemedica-private into private/ so ${CASES_PATH} exists`)
  const model = values.model
  const proposer = new Proposer(model)
  const cases = loadCases()

  const answers = await pool(cases, CONCURRENCY, async (item) => {
    const answer = await proposer.propose(item.query)
    const place = answer.remedies.findIndex((remedy) => item.expected.includes(remedy))
    return { item, answer, rank: place < 0 ? null : place + 1 }
  })

  console.log(`${cases.length} cases, ${model} unaided, ${PROPOSED_REMEDIES} remedies each\n`)
  const header = CUTOFFS.map((cutoff) => `top ${cutoff}`.padStart(7)).join('')
  console.log(`  ${''.padEnd(22)}${'n'.padStart(5)}${header}${'MRR'.padStart(7)}${'95%'.padStart(11)}`)
  console.log(summary('all cases', answers.map((answer) => answer.rank)))
  console.log(summary('not recognised', answers.filter((answer) => !answer.answer.recognised).map((answer) => answer.rank)))
  console.log(summary('recognised', answers.filter((answer) => answer.answer.recognised).map((answer) => answer.rank)))
  const unknown = answers.flatMap((answer) => answer.answer.unknown)
  if (unknown.length) console.log(`\nnames not among the corpus's remedy ids, left out: ${[...new Set(unknown)].join(', ')}`)
  if (proposer.reused) console.log(`replies to ${proposer.reused} cases reused from the cache`)

  // Production's place for the cured remedy among its sources, from a retrieval eval's --out file.
  let production = new Map<string, number | null>()
  if (values.against) {
    const { results } = JSON.parse(readFileSync(values.against, 'utf8')) as { results: { arm: string; id: string; rank: number | null }[] }
    production = new Map(results.filter((result) => result.arm === 'production').map((result) => [result.id, result.rank]))
    const both = answers.filter((answer) => production.has(answer.item.id))
    const within = (rank: number | null | undefined) => rank !== null && rank !== undefined && rank <= 5
    const count = (test: (answer: (typeof answers)[number]) => boolean) => both.filter(test).length
    console.log(
      `\nagainst production's sources, cured remedy in the first five: both ${count((a) => within(a.rank) && within(production.get(a.item.id)))}, ` +
        `only unaided ${count((a) => within(a.rank) && !within(production.get(a.item.id)))}, ` +
        `only production ${count((a) => !within(a.rank) && within(production.get(a.item.id)))}, ` +
        `neither ${count((a) => !within(a.rank) && !within(production.get(a.item.id)))}`,
    )
  }

  console.log('\ncase by case: unaided rank, production rank, recognised, cured remedy, first three named')
  for (const { item, answer, rank } of answers) {
    const productionRank = production.has(item.id) ? String(production.get(item.id) ?? '-') : ''
    console.log(
      `  ${String(rank ?? '-').padStart(3)} ${productionRank.padStart(3)}  ${answer.recognised ? 'yes' : 'no '}  ${item.expected.join('/').padEnd(26)} ${answer.remedies.slice(0, 3).join(', ').padEnd(60)} ${item.id}`,
    )
  }
}

await main()
