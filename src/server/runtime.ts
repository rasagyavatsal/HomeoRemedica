/** Build the production chat service from the Qdrant collections. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

import { type Accounts, firebaseAccounts } from './accounts.ts'
import { ConfigurationError } from './errors.ts'
import { ZaiChatClient } from './generation.ts'
import { ChatService } from './service.ts'
import { VoyageQueryEmbedder } from './embeddings.ts'
import { CorpusError, QdrantCorpus } from './qdrant.ts'
import { EXTRACTION_MAX_OUTPUT_TOKENS, ModelSymptomExtractor, QdrantRubrics, Repertory } from './repertory.ts'
import { ProductionRetriever } from './retrieval.ts'

export const DEFAULT_MODEL = 'glm-5.3-flash'
export const MAX_OUTPUT_TOKENS = 4_096

export interface Settings {
  qdrantUrl: string | undefined
  qdrantApiKey: string | undefined
  model: string
  maxOutputTokens: number
  zaiApiKey: string | undefined
  openrouterApiKey: string | undefined
  /** Accounts are offered only when both Firebase settings are set. */
  firebaseProjectId: string | undefined
  firebaseApiKey: string | undefined
  firebaseAuthDomain: string | undefined
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
    model: value('RAG_MODEL') ?? DEFAULT_MODEL,
    maxOutputTokens: Number(maxOutputTokens),
    zaiApiKey: value('ZAI_API_KEY'),
    openrouterApiKey: value('OPENROUTER_API_KEY'),
    firebaseProjectId: value('FIREBASE_PROJECT_ID'),
    firebaseApiKey: value('FIREBASE_API_KEY'),
    firebaseAuthDomain: value('FIREBASE_AUTH_DOMAIN'),
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

/** Repertorisation with the answer model, checked to have its Qdrant collection. */
export async function loadRepertory(settings: Settings, embedder: VoyageQueryEmbedder): Promise<Repertory> {
  if (!settings.qdrantUrl) {
    throw new ConfigurationError('a Qdrant URL is required; set QDRANT_URL in the environment or .env')
  }
  const rubrics = new QdrantRubrics({ url: settings.qdrantUrl, apiKey: settings.qdrantApiKey })
  if (!(await rubrics.exists())) throw new CorpusError('the Qdrant repertory collection does not exist')
  const extractor = new ZaiChatClient({
    apiKey: settings.zaiApiKey,
    model: settings.model,
    maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
  })
  return new Repertory({ extractor: new ModelSymptomExtractor(extractor), embedder, rubrics })
}

export function loadCorpus(settings: Settings): QdrantCorpus {
  if (!settings.qdrantUrl) {
    throw new ConfigurationError('a Qdrant URL is required; set QDRANT_URL in the environment or .env')
  }
  return new QdrantCorpus({
    url: settings.qdrantUrl,
    apiKey: settings.qdrantApiKey,
  })
}

/** Sign-in and saved chats, or null when Firebase is not configured. */
export function loadAccounts(settings: Settings): Accounts | null {
  const { firebaseProjectId: projectId, firebaseApiKey: apiKey } = settings
  if (!projectId || !apiKey) return null
  return firebaseAccounts({ apiKey, projectId, authDomain: settings.firebaseAuthDomain ?? `${projectId}.firebaseapp.com` })
}
