/** Build the production chat service from the Qdrant collection. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { ConfigurationError } from './errors.ts'
import { ZaiChatClient } from './generation.ts'
import { ChatService } from './service.ts'
import { VoyageQueryEmbedder } from './embeddings.ts'
import { COLLECTION, QdrantCorpus } from './qdrant.ts'
import { ProductionRetriever } from './retrieval.ts'

export const DEFAULT_MODEL = 'glm-5.3-flash'
export const MAX_OUTPUT_TOKENS = 4_096

export interface Settings {
  qdrantUrl: string | undefined
  qdrantApiKey: string | undefined
  qdrantCollection: string
  model: string
  maxOutputTokens: number
  zaiApiKey: string | undefined
  openrouterApiKey: string | undefined
}

/**
 * Read settings from the process environment, then `.env.local`, then `.env`.
 * Empty values count as unset.
 */
export function loadSettings(
  env: Record<string, string | undefined> = process.env,
  directory: string = process.cwd(),
): Settings {
  const values: Record<string, string | undefined> = {
    ...readEnvFile(join(directory, '.env')),
    ...readEnvFile(join(directory, '.env.local')),
    ...env,
  }
  const value = (name: string) => values[name]?.trim() || undefined
  const maxOutputTokens = value('RAG_MAX_OUTPUT_TOKENS') ?? String(MAX_OUTPUT_TOKENS)
  if (!/^\d+$/.test(maxOutputTokens) || +maxOutputTokens < 1 || +maxOutputTokens > MAX_OUTPUT_TOKENS) {
    throw new ConfigurationError(`RAG_MAX_OUTPUT_TOKENS must be an integer from 1 to ${MAX_OUTPUT_TOKENS}`)
  }
  return {
    qdrantUrl: value('QDRANT_URL'),
    qdrantApiKey: value('QDRANT_API_KEY'),
    qdrantCollection: value('RAG_QDRANT_COLLECTION') ?? COLLECTION,
    model: value('RAG_MODEL') ?? DEFAULT_MODEL,
    maxOutputTokens: Number(maxOutputTokens),
    zaiApiKey: value('ZAI_API_KEY'),
    openrouterApiKey: value('OPENROUTER_API_KEY'),
  }
}

function readEnvFile(path: string): Record<string, string> {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  return parseEnv(content) as Record<string, string>
}

export async function buildService(settings: Settings): Promise<ChatService> {
  const embedder = new VoyageQueryEmbedder({ apiKey: settings.openrouterApiKey })
  const generator = new ZaiChatClient({
    apiKey: settings.zaiApiKey,
    model: settings.model,
    maxOutputTokens: settings.maxOutputTokens,
  })
  const corpus = loadCorpus(settings)
  await corpus.verify()
  return new ChatService({ retriever: new ProductionRetriever(corpus, embedder), generator })
}

export function loadCorpus(settings: Settings): QdrantCorpus {
  if (!settings.qdrantUrl) {
    throw new ConfigurationError('a Qdrant URL is required; set QDRANT_URL in the environment or .env')
  }
  return new QdrantCorpus({
    url: settings.qdrantUrl,
    apiKey: settings.qdrantApiKey,
    collection: settings.qdrantCollection,
  })
}
