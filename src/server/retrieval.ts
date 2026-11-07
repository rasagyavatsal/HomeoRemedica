/** Production query embedding and corpus search. */

import {
  type ChatRequest,
  MAX_RETRIEVAL_QUERY_CHARS,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import { ChatFailure, ProviderError, isTimeout } from './errors.ts'
import type { Repertoriser } from './repertory.ts'

const PREVIOUS_QUESTIONS = 2
/** A described case's passages come from this many of the repertory's leading remedies. */
export const CANDIDATE_REMEDIES = 20

export interface QueryEmbedder {
  embedQuery(text: string): Promise<readonly number[]>
}

export interface SearchableRelease {
  readonly corpusVersion: string
  search(
    query: string,
    embedding: readonly number[],
    options: { limit: number; remedies?: readonly string[] | undefined },
  ): Promise<readonly RetrievedSource[]>
}

export class ProductionRetriever implements Retriever {
  readonly corpusVersion: string
  readonly #corpus: SearchableRelease
  readonly #embedder: QueryEmbedder
  readonly #repertory: Repertoriser | undefined
  readonly #candidates: number

  /**
   * With a repertory, a question that describes a patient is searched only among the passages of
   * the remedies the repertory ranks highest for its symptoms.
   */
  constructor(
    corpus: SearchableRelease,
    embedder: QueryEmbedder,
    { repertory, candidates = CANDIDATE_REMEDIES }: { repertory?: Repertoriser | undefined; candidates?: number } = {},
  ) {
    this.#corpus = corpus
    this.#embedder = embedder
    this.#repertory = repertory
    this.#candidates = candidates
    this.corpusVersion = corpus.corpusVersion
  }

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<readonly RetrievedSource[]> {
    // Earlier questions resolve follow-ups such as "what about its mental symptoms?". Answers are
    // left out: they are long enough to drown the question in both rankings.
    const questions = request.history.filter((turn) => turn.role === 'user').slice(-PREVIOUS_QUESTIONS)
    const query = [...questions.map((turn) => turn.content), request.message]
      .join('\n')
      .slice(-MAX_RETRIEVAL_QUERY_CHARS)
    const [embedding, remedies] = await Promise.all([this.#embed(query), this.#candidateRemedies(query)])
    return this.#corpus.search(query, embedding, { limit, remedies })
  }

  async #embed(query: string): Promise<readonly number[]> {
    try {
      return await this.#embedder.embedQuery(query)
    } catch (error) {
      if (error instanceof ChatFailure) throw error
      const kind = isTimeout(error) ? 'timeout' : error instanceof ProviderError ? 'provider' : 'internal'
      throw new ChatFailure({ stage: 'embedding', kind, cause: error })
    }
  }

  /** The repertory's leading remedies for the case the query describes, if it describes one. */
  async #candidateRemedies(query: string): Promise<string[] | undefined> {
    if (!this.#repertory) return undefined
    try {
      const { remedies } = await this.#repertory.repertorise(query)
      return remedies.length ? remedies.slice(0, this.#candidates).map((remedy) => remedy.remedyId) : undefined
    } catch (error) {
      // The repertory narrows the search; without it the whole corpus is still searched.
      console.error('Repertorisation failed; searching the whole corpus', error)
      return undefined
    }
  }
}
