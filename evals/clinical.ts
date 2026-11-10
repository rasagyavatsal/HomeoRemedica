/**
 * The diseases a model names for each case, asked once and kept in .cache/retrieval-diseases.json,
 * keyed by the model, production's disease instruction and the case, so every arm and every later
 * run of the retrieval eval matches the same diseases to Clarke's clinical terms.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DISEASE_INSTRUCTION, type DiseaseExtractor, parseDiseases } from '../src/server/clinical.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DISEASES_CACHE = join(ROOT, '.cache', 'retrieval-diseases.json')

export class CachedDiseaseExtractor implements DiseaseExtractor {
  readonly #model: string
  readonly #ask: (prompt: string, system: string) => Promise<string>
  readonly #stored: Record<string, string>
  readonly #results = new Map<string, Promise<string[]>>()
  reused = 0

  /** `ask` puts a prompt and system instruction to the model and returns its reply. */
  constructor(model: string, ask: (prompt: string, system: string) => Promise<string>) {
    this.#model = model
    this.#ask = ask
    this.#stored = existsSync(DISEASES_CACHE) ? JSON.parse(readFileSync(DISEASES_CACHE, 'utf8')) : {}
  }

  extractDiseases(text: string): Promise<string[]> {
    let result = this.#results.get(text)
    if (!result) {
      result = this.#extract(text)
      this.#results.set(text, result)
    }
    return result
  }

  async #extract(text: string): Promise<string[]> {
    const key = createHash('sha256').update(`${this.#model}\n${DISEASE_INSTRUCTION}\n${text}`).digest('hex')
    let reply = this.#stored[key]
    if (reply === undefined) {
      reply = await this.#ask(`<case>\n${text}\n</case>`, DISEASE_INSTRUCTION)
      this.#stored[key] = reply
      mkdirSync(dirname(DISEASES_CACHE), { recursive: true })
      writeFileSync(DISEASES_CACHE, JSON.stringify(this.#stored, null, 1))
    } else {
      this.reused++
    }
    return parseDiseases(reply)
  }
}
