/** A promptfoo provider that answers through the production retrieve-and-generate pipeline. */

import { fileURLToPath } from 'node:url'

import { ChatRequestSchema } from '../src/server/contracts.ts'
import { buildService, loadSettings } from '../src/server/runtime.ts'
import type { ChatService } from '../src/server/service.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The parts of a promptfoo provider response that the eval reads. */
interface ProviderResponse {
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

interface CallContext {
  vars?: Record<string, unknown>
}

export default class HomeoRemedicaProvider {
  #service: Promise<ChatService> | undefined

  id(): string {
    return 'homeoremedica'
  }

  async callApi(prompt: string, context?: CallContext): Promise<ProviderResponse> {
    this.#service ??= buildService(loadSettings(process.env, ROOT))
    const service = await this.#service
    // Earlier turns arrive as a JSON string, since promptfoo expands array vars into separate tests.
    const history = typeof context?.vars?.history === 'string' ? JSON.parse(context.vars.history) : []
    const request = ChatRequestSchema.parse({ message: prompt, history })
    try {
      const response = await service.chat(request)
      return {
        output: response.answer,
        metadata: {
          model: response.model,
          corpusVersion: response.corpusVersion,
          sources: response.sources.map(({ bookId, remedyName, sectionTitle }) => ({ bookId, remedyName, sectionTitle })),
          // Numbered as in the generation prompt, so the judge can follow the answer's citations.
          context: response.sources.map((source, index) => `[${index + 1}] ${source.text}`),
        },
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
