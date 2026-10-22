/** Production query embedding and corpus search. */

import {
  type ChatRequest,
  MAX_RETRIEVAL_QUERY_CHARS,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import { ChatFailure, ProviderError, isTimeout } from './errors.ts'

const PREVIOUS_QUESTIONS = 2

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
    // Earlier questions resolve follow-ups such as "what about its mental symptoms?". Answers are
    // left out: they are long enough to drown the question in both rankings.
    const questions = request.history.filter((turn) => turn.role === 'user').slice(-PREVIOUS_QUESTIONS)
    const query = [...questions.map((turn) => turn.content), request.message]
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
