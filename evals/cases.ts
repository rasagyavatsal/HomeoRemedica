/**
 * The cured cases every eval asks, kept in the HomeoRemedica-private clone at
 * `private/eval/cases.yaml`, and the remedy each corpus chunk is about, read from its `chunks/`.
 *
 * promptfoo loads `tests` from here as its corpus cases; `retrieval.ts` scores the same cases.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const CASES_PATH = join(ROOT, 'private', 'eval', 'cases.yaml')
const CHUNKS = join(ROOT, 'private', 'chunks')

export interface Case {
  id: string
  source: string
  query: string
  /** Remedy ids of the remedy that cured; a source on any one of them counts. */
  expected: readonly string[]
  /** Remedy ids a good answer weighs against the expected one. */
  differential: readonly string[]
}

export function hasPrivateClone(): boolean {
  return existsSync(CASES_PATH) && existsSync(CHUNKS)
}

let chunkRemedies: Map<string, string | null> | undefined
let names: Map<string, string[]> | undefined

/** The remedy id of every chunk, by chunk id; null for chunks about no single remedy. */
export function remedyIds(): Map<string, string | null> {
  if (!chunkRemedies) readChunks()
  return chunkRemedies!
}

/** The names the books give each remedy, by remedy id, such as `Rhus Toxicodendron`. */
export function remedyNames(): Map<string, string[]> {
  if (!names) readChunks()
  return names!
}

function readChunks(): void {
  chunkRemedies = new Map()
  const found = new Map<string, Set<string>>()
  for (const name of readdirSync(CHUNKS).filter((file) => file.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(CHUNKS, name), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { id: string; remedy_id?: string | null; remedy?: string | null }
      chunkRemedies.set(chunk.id, chunk.remedy_id ?? null)
      if (chunk.remedy_id && chunk.remedy) found.set(chunk.remedy_id, (found.get(chunk.remedy_id) ?? new Set()).add(chunk.remedy))
    }
  }
  names = new Map([...found].map(([remedyId, remedyNames]) => [remedyId, [...remedyNames]]))
}

/** A remedy as the books name it, with its other names, such as `Rhus Toxicodendron (Rhus Tox.)`. */
function described(remedyId: string): string {
  const [first, ...others] = remedyNames().get(remedyId) ?? [remedyId]
  return others.length ? `${first} (also ${others.join(', ')})` : first!
}

function remedyList(value: unknown, field: string, id: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${CASES_PATH}: case ${id} needs ${field} as a list of remedy ids`)
  }
  return value
}

/** The cases, checked so that every remedy id they name is one some chunk is about. */
export function loadCases(): Case[] {
  const known = new Set(remedyIds().values())
  const cases = (parse(readFileSync(CASES_PATH, 'utf8')) as Record<string, unknown>[]).map((raw, index) => {
    const id = typeof raw.id === 'string' ? raw.id : `#${index + 1}`
    if (typeof raw.query !== 'string' || typeof raw.source !== 'string') {
      throw new Error(`${CASES_PATH}: case ${id} needs a query and a source`)
    }
    const expected = remedyList(raw.expected, 'expected', id)
    const differential = remedyList(raw.differential, 'differential', id)
    if (!expected.length) throw new Error(`${CASES_PATH}: case ${id} expects no remedy`)
    const unknown = [...expected, ...differential].filter((remedy) => !known.has(remedy))
    if (unknown.length) throw new Error(`${CASES_PATH}: case ${id}: no chunk has remedy id ${unknown.join(', ')}`)
    return { id, source: raw.source, query: raw.query, expected, differential }
  })
  const ids = cases.map((item) => item.id)
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (repeated.length) throw new Error(`${CASES_PATH}: repeated case ids ${repeated.join(', ')}`)
  return cases
}

/**
 * The grounding comparison's tests, one per case: only checks that an answer from the books and
 * one from the model alone can both pass, judged on what the answer says rather than what it cites.
 */
export function comparisonTests(): unknown[] {
  if (!hasPrivateClone()) {
    console.warn('The private clone is missing from private/, so only the guardrail tests run.')
    return []
  }
  return loadCases().map((item) => ({
    description: item.id,
    vars: {
      query: item.query,
      cured: item.expected.map(described).join(' or '),
      differential: item.differential.map(described).join('; ') || 'none',
    },
    assert: [
      {
        type: 'llm-rubric',
        metric: 'cured remedy',
        value: 'Among the remedies the answer puts forward for this case is {{cured}}.',
      },
      {
        type: 'llm-rubric',
        metric: 'differential',
        value:
          'Score the share of these remedies that the answer puts forward for this case: {{differential}}. ' +
          'Pass if it puts forward at least one of them, or if the list is none.',
      },
      {
        type: 'llm-rubric',
        metric: 'case answer',
        value:
          "Lists the remedies that match this patient's case, and for each gives the case's characteristic " +
          'symptoms it covers, so a practitioner can narrow them down. Fails if it declines, settles on a ' +
          'single remedy, matches remedies on one symptom alone, or gives only general advice.',
      },
      {
        type: 'llm-rubric',
        metric: 'accuracy',
        value:
          "Every statement the answer makes about a remedy's symptoms, modalities or keynotes agrees with " +
          'the classical materia medica of Hahnemann, Allen, Boericke, Clarke and Kent. Fails if it gives a ' +
          'remedy a symptom or modality those books do not, or contradicts them. An answer that names no ' +
          'remedies passes.',
      },
    ],
  }))
}

/** promptfoo's corpus tests, one per case. Remedy lists are joined, since promptfoo expands arrays. */
export function tests(): unknown[] {
  if (!hasPrivateClone()) {
    console.warn('The private clone is missing from private/, so only the guardrail tests run.')
    return []
  }
  return loadCases().map((item) => ({
    description: item.id,
    vars: { query: item.query, expected: item.expected.join(','), differential: item.differential.join(',') },
    assert: [
      { type: 'javascript', value: 'file://assertions.ts:cites', metric: 'citations' },
      { type: 'javascript', value: 'file://assertions.ts:retrieved', metric: 'retrieval' },
      { type: 'javascript', value: 'file://assertions.ts:named', metric: 'relevance' },
      { type: 'javascript', value: 'file://assertions.ts:differential', metric: 'differential' },
      {
        type: 'llm-rubric',
        metric: 'relevance',
        value:
          "Lists the remedies the source excerpts match to this patient's case, and for each gives the " +
          "case's characteristic symptoms it covers, so a practitioner can narrow them down. Fails if it " +
          'declines, settles on a single remedy, matches remedies on one symptom alone, or gives only ' +
          'general advice.',
      },
      {
        type: 'llm-rubric',
        transform: 'file://assertions.ts:withSources',
        metric: 'faithfulness',
        value:
          'Every claim the answer makes about remedies, symptoms, modalities or doctrine is supported by ' +
          'the source excerpts it cites, and none contradicts them. Safety caveats and remarks that the ' +
          'sources are silent on a point need no support.',
      },
    ],
  }))
}
