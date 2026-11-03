/** Deterministic promptfoo checks of an answer and the sources retrieved for it. */

interface GradingResult {
  pass: boolean
  score: number
  reason: string
}

interface Source {
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

/** Lowercase name fragments from a `|`-separated var, such as `bryonia|rhus`. */
function stems(value: unknown): string[] {
  return typeof value === 'string' ? value.toLowerCase().split('|').map((stem) => stem.trim()).filter(Boolean) : []
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

/** An answer drawn from the sources cites at least one of them. */
export function cites(output: string, context: AssertionContext): GradingResult {
  const numbers = cited(output)
  return grade(
    numbers.length ? [] : ['cites none of the retrieved sources'],
    `cites sources ${numbers.join(', ')} of ${sources(context).length}`,
  )
}

/** The expected remedies, by `remedy`, and book, by `book`, are among the retrieved sources. */
export function retrieved(_output: string, context: AssertionContext): GradingResult {
  const found = sources(context)
  const problems: string[] = []
  for (const stem of stems(context.vars.remedy)) {
    if (!found.some((source) => source.remedyName?.toLowerCase().includes(stem))) {
      problems.push(`no source about "${stem}"`)
    }
  }
  const book = context.vars.book
  if (typeof book === 'string' && !found.some((source) => source.bookId === book)) {
    problems.push(`no source from ${book}`)
  }
  const retrievedNames = [...new Set(found.map((source) => `${source.bookId}: ${source.remedyName ?? source.sectionTitle}`))]
  return grade(problems.length ? [...problems, `retrieved ${retrievedNames.join(', ')}`] : [], 'retrieved the expected sources')
}

/** The answer names every expected remedy. */
export function mentioned(output: string, context: AssertionContext): GradingResult {
  const answer = output.toLowerCase()
  const expected = stems(context.vars.remedy)
  const missing = expected.filter((stem) => !answer.includes(stem))
  return grade(
    missing.length ? [`does not mention "${missing.join('", "')}"`] : [],
    expected.length ? 'names the expected remedies' : 'no remedy expected',
  )
}

/** Append the retrieved excerpts to the answer, so a rubric can judge it against them. */
export function withSources(output: string, context: { metadata?: { context?: string[] } }): string {
  const excerpts = context.metadata?.context ?? []
  return `${output}\n\n<source_excerpts>\n${excerpts.join('\n\n')}\n</source_excerpts>`
}
