/** Production query embedding and corpus search. */

import {
  type ChatRequest,
  MAX_RETRIEVAL_QUERY_CHARS,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import type { ClinicalRanker } from './clinical.ts'
import { ChatFailure, ProviderError, isTimeout } from './errors.ts'
import type { Repertoriser } from './repertory.ts'

const PREVIOUS_QUESTIONS = 2

export interface QueryEmbedder {
  embedQuery(text: string): Promise<readonly number[]>
}

export interface SearchableRelease {
  readonly corpusVersion: string
  search(
    query: string,
    embedding: readonly number[],
    options: { limit: number; priors?: readonly (readonly string[])[] | undefined },
  ): Promise<readonly RetrievedSource[]>
}

export class ProductionRetriever implements Retriever {
  readonly corpusVersion: string
  readonly #corpus: SearchableRelease
  readonly #embedder: QueryEmbedder
  readonly #repertory: Repertoriser | undefined
  readonly #clinical: ClinicalRanker | undefined

  /**
   * The whole corpus is searched. With a repertory, its ranking of remedies for the symptoms of a
   * question that describes a patient is fused with the books' support for each remedy. With
   * `clinical`, Clarke's remedies for the diseases the case names are fused beside it. The
   * rankings and the books' support all count the same.
   */
  constructor(
    corpus: SearchableRelease,
    embedder: QueryEmbedder,
    { repertory, clinical }: { repertory?: Repertoriser | undefined; clinical?: ClinicalRanker | undefined } = {},
  ) {
    this.#corpus = corpus
    this.#embedder = embedder
    this.#repertory = repertory
    this.#clinical = clinical
    this.corpusVersion = corpus.corpusVersion
  }

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<readonly RetrievedSource[]> {
    // Earlier questions resolve follow-ups such as "what about its mental symptoms?". Answers are
    // left out: they are long enough to drown the question in both rankings.
    const questions = request.history.filter((turn) => turn.role === 'user').slice(-PREVIOUS_QUESTIONS)
    const query = [...questions.map((turn) => turn.content), request.message]
      .join('\n')
      .slice(-MAX_RETRIEVAL_QUERY_CHARS)
    const [embedding, ...rankings] = await Promise.all([
      this.#embed(query),
      this.#repertoryRanking(query),
      this.#clinicalRanking(query),
    ])
    const priors = rankings.filter((ranking) => ranking !== undefined)
    return this.#corpus.search(query, embedding, { limit, priors })
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

  /** Clarke's remedies for the diseases the query names, best first. */
  async #clinicalRanking(query: string): Promise<readonly string[] | undefined> {
    if (!this.#clinical) return undefined
    try {
      const { ranking } = await this.#clinical.rank(query)
      return ranking.length ? ranking : undefined
    } catch (error) {
      // Like the repertory, Clarke's terms only reorder the search.
      console.error("Matching Clarke's clinical terms failed; searching without them", error)
      return undefined
    }
  }

  /** The repertory's remedies for the case the query describes, best first, if it describes one. */
  async #repertoryRanking(query: string): Promise<string[] | undefined> {
    if (!this.#repertory) return undefined
    try {
      const { remedies } = await this.#repertory.repertorise(query)
      return remedies.length ? remedies.map((remedy) => remedy.remedyId) : undefined
    } catch (error) {
      // The repertory only reorders the search; without it the corpus is searched as usual.
      console.error('Repertorisation failed; searching without it', error)
      return undefined
    }
  }
}
