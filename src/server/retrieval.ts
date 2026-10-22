/** Production query embedding and corpus search. */

import {
  type ChatRequest,
  MAX_RETRIEVAL_QUERY_CHARS,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import { ChatFailure, ProviderError, isTimeout } from './errors.ts'

export interface QueryEmbedder {
  embedQuery(text: string): Promise<readonly number[]>
}

export interface SearchableRelease {
  readonly corpusVersion: string
  search(
    query: string,
    embedding: readonly number[],
    options: { limit: number },
  ): Promise<readonly RetrievedSource[]>
}

export class ProductionRetriever implements Retriever {
  readonly corpusVersion: string
  readonly #corpus: SearchableRelease
  readonly #embedder: QueryEmbedder

  constructor(corpus: SearchableRelease, embedder: QueryEmbedder) {
    this.#corpus = corpus
    this.#embedder = embedder
    this.corpusVersion = corpus.corpusVersion
  }

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<readonly RetrievedSource[]> {
    const recent = [...request.history.slice(-4), { role: 'user', content: request.message }]
    const query = recent
      .map((turn) => turn.content)
      .join('\n')
      .slice(-MAX_RETRIEVAL_QUERY_CHARS)
    let embedding: readonly number[]
    try {
      embedding = await this.#embedder.embedQuery(query)
    } catch (error) {
      if (error instanceof ChatFailure) throw error
      const kind = isTimeout(error) ? 'timeout' : error instanceof ProviderError ? 'provider' : 'internal'
      throw new ChatFailure({ stage: 'embedding', kind, cause: error })
    }
    return this.#corpus.search(query, embedding, { limit })
  }
}
