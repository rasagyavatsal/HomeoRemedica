/** A deterministic promptfoo check of an answer against the sources retrieved for it. */

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

function cited(output: string): number[] {
  return [...new Set([...output.matchAll(CITATION)].flatMap((match) => (match[1] ?? '').split(',').map(Number)))]
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
