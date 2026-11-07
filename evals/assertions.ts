/** Deterministic promptfoo checks of an answer and the sources retrieved for it. */

import { remedyIds } from './cases.ts'

interface GradingResult {
  pass: boolean
  score: number
  reason: string
}

interface Source {
  chunkId: string
  bookId: string
  remedyName: string | null
  sectionTitle: string
}

interface AssertionContext {
  vars: Record<string, unknown>
  providerResponse?: { metadata?: { sources?: Source[] } }
}

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g

function grade(problems: string[], passed: string): GradingResult {
  return problems.length
    ? { pass: false, score: 0, reason: problems.join('; ') }
    : { pass: true, score: 1, reason: passed }
}

function sources(context: AssertionContext): Source[] {
  return context.providerResponse?.metadata?.sources ?? []
}

/** Remedy ids from a comma-separated var, such as `bryonia,rhus-toxicodendron`. */
function remedies(value: unknown): string[] {
  return typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : []
}

function remedyOf(source: Source): string | null {
  return remedyIds().get(source.chunkId) ?? null
}

function cited(output: string): number[] {
  return [...new Set([...output.matchAll(CITATION)].flatMap((match) => (match[1] ?? '').split(',').map(Number)))]
}

/** The remedies of the sources the answer cites. */
function citedRemedies(output: string, context: AssertionContext): Set<string | null> {
  const found = sources(context)
  return new Set(cited(output).flatMap((number) => (found[number - 1] ? [remedyOf(found[number - 1]!)] : [])))
}

/** Every `[n]` names a retrieved source. */
export function citations(output: string, context: AssertionContext): GradingResult {
  const count = sources(context).length
  const unknown = cited(output).filter((number) => number < 1 || number > count)
  return grade(
    unknown.length ? [`cites [${unknown.join('], [')}] but only ${count} sources were retrieved`] : [],
    'every citation names a retrieved source',
  )
}

/** An answer drawn from the sources cites at least one of them. */
export function cites(output: string, context: AssertionContext): GradingResult {
  const numbers = cited(output)
  return grade(
    numbers.length ? [] : ['cites none of the retrieved sources'],
    `cites sources ${numbers.join(', ')} of ${sources(context).length}`,
  )
}

/** A source on the remedy that cured the case is among those retrieved. */
export function retrieved(_output: string, context: AssertionContext): GradingResult {
  const expected = remedies(context.vars.expected)
  const found = sources(context).map(remedyOf)
  const names = [...new Set(found.map((remedy) => remedy ?? '(no remedy)'))]
  return grade(
    found.some((remedy) => remedy !== null && expected.includes(remedy))
      ? []
      : [`no source on ${expected.join(' or ')}; retrieved ${names.join(', ')}`],
    `retrieved a source on ${expected.join(' or ')}`,
  )
}

/** The answer cites a source on the remedy that cured the case, so puts it forward. */
export function named(output: string, context: AssertionContext): GradingResult {
  const expected = remedies(context.vars.expected)
  const remediesCited = citedRemedies(output, context)
  return grade(
    expected.some((remedy) => remediesCited.has(remedy)) ? [] : [`cites no source on ${expected.join(' or ')}`],
    `cites a source on ${expected.join(' or ')}`,
  )
}

/**
 * The share of the case's differential the answer cites a source on. It is reported rather than
 * failed, since the differential is a judgement and the answer may weigh other sound candidates.
 */
export function differential(output: string, context: AssertionContext): GradingResult {
  const wanted = remedies(context.vars.differential)
  if (!wanted.length) return { pass: true, score: 1, reason: 'no differential given' }
  const remediesCited = citedRemedies(output, context)
  const covered = wanted.filter((remedy) => remediesCited.has(remedy))
  const missing = wanted.filter((remedy) => !remediesCited.has(remedy))
  return {
    pass: true,
    score: covered.length / wanted.length,
    reason: `cites ${covered.length} of ${wanted.length} differential remedies${missing.length ? `; not ${missing.join(', ')}` : ''}`,
  }
}

/** Append the retrieved excerpts to the answer, so a rubric can judge it against them. */
export function withSources(output: string, context: { metadata?: { context?: string[] } }): string {
  const excerpts = context.metadata?.context ?? []
  return `${output}\n\n<source_excerpts>\n${excerpts.join('\n\n')}\n</source_excerpts>`
}
