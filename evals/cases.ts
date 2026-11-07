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

/** The remedy id of every chunk, by chunk id; null for chunks about no single remedy. */
export function remedyIds(): Map<string, string | null> {
  if (chunkRemedies) return chunkRemedies
  chunkRemedies = new Map()
  for (const name of readdirSync(CHUNKS).filter((file) => file.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(CHUNKS, name), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { id: string; remedy_id?: string | null }
      chunkRemedies.set(chunk.id, chunk.remedy_id ?? null)
    }
  }
  return chunkRemedies
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
          "Puts forward the remedies the source excerpts match to this patient's case, compares them by " +
          "which of the case's characteristic symptoms each one covers, and says which fits best, rather " +
          'than declining, picking from one symptom alone, or giving only general advice.',
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
