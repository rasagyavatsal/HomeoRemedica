/**
 * A model's remedies for a case from the case alone, without retrieval, as the unaided eval scores
 * them and as the retrieval eval weighs them.
 *
 * A Claude model runs through the Claude Code CLI on its signed-in subscription; any other model is
 * asked through Z.AI like production's answer model. Replies are kept in .cache/unaided.json, keyed
 * by the model, the instructions and the case, so later runs of either eval reuse them.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ZaiChatClient } from '../src/server/generation.ts'
import { EXTRACTION_MAX_OUTPUT_TOKENS } from '../src/server/repertory.ts'
import { loadSettings } from '../src/server/runtime.ts'
import { remedyIds } from './cases.ts'
import { askClaude } from './claude.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CACHE = join(ROOT, '.cache', 'unaided.json')
export const PROPOSED_REMEDIES = 10

export interface Proposal {
  /** Remedy ids, best first. */
  remedies: string[]
  /** Names the model gave that are not the corpus's remedy ids, left out of `remedies`. */
  unknown: string[]
  /** Whether the model says it has read this very case before. */
  recognised: boolean
}

function instructions(known: readonly string[]): string {
  return `You are an experienced classical homoeopath. The user gives you a patient's case. Name the
${PROPOSED_REMEDIES} remedies most likely to be the simillimum, best first, as a homoeopath would choose them
from the totality of the case and its strange, rare and peculiar symptoms.

Name each remedy by its id from this list, exactly as written:
${known.join(', ')}

Also say whether you recognise this case from the homoeopathic literature, that is, whether you
have read this very case before.

Reply with JSON only, in this form:
{"remedies": ["id", ...], "recognised": true or false}`
}

function parseProposal(text: string, known: ReadonlySet<string>): Proposal {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const parsed = JSON.parse(json) as { remedies?: unknown; recognised?: unknown }
  const named = Array.isArray(parsed.remedies) ? parsed.remedies.filter((remedy) => typeof remedy === 'string') : []
  return {
    remedies: [...new Set(named.filter((remedy) => known.has(remedy)))].slice(0, PROPOSED_REMEDIES),
    unknown: named.filter((remedy) => !known.has(remedy)),
    recognised: parsed.recognised === true,
  }
}

/** Asks a Claude model through the CLI, or any other through Z.AI with production's settings. */
function asker(model: string): (prompt: string, system: string) => Promise<string> {
  if (model.startsWith('claude-')) return async (prompt, system) => (await askClaude(prompt, { model, system })).text
  const client = new ZaiChatClient({
    apiKey: loadSettings(process.env, ROOT).zaiApiKey,
    model,
    // The model reasons first, and its reasoning counts against this, as for symptom extraction.
    maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    // Reasoning over the case and the corpus's remedy ids takes longer than an answer.
    timeoutMs: 300_000,
  })
  return (prompt, system) => client.generate(prompt, { systemInstruction: system })
}

export class Proposer {
  readonly model: string
  readonly #ask: (prompt: string, system: string) => Promise<string>
  readonly #known: ReadonlySet<string>
  readonly #system: string
  readonly #stored: Record<string, string>
  readonly #results = new Map<string, Promise<Proposal>>()
  reused = 0

  constructor(model: string) {
    this.model = model
    this.#ask = asker(model)
    const known = [...new Set([...remedyIds().values()].filter((remedy) => remedy !== null))].sort()
    this.#known = new Set(known)
    this.#system = instructions(known)
    this.#stored = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
  }

  /** The model's remedies for the case, asked once however often it is called. */
  propose(caseText: string): Promise<Proposal> {
    let result = this.#results.get(caseText)
    if (!result) {
      result = this.#propose(caseText)
      this.#results.set(caseText, result)
    }
    return result
  }

  async #propose(caseText: string): Promise<Proposal> {
    const key = createHash('sha256').update(`${this.model}\n${this.#system}\n${caseText}`).digest('hex')
    const stored = this.#stored[key]
    if (stored !== undefined) {
      this.reused++
      return parseProposal(stored, this.#known)
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const text = await this.#ask(caseText, this.#system)
        const proposal = parseProposal(text, this.#known)
        this.#stored[key] = text
        mkdirSync(dirname(CACHE), { recursive: true })
        writeFileSync(CACHE, JSON.stringify(this.#stored, null, 1))
        return proposal
      } catch (error) {
        if (attempt === 3) throw error
        console.error(`retrying a proposal after ${error instanceof Error ? error.message : 'an error'}`)
      }
    }
  }
}
