/** Production query embedding and corpus search. */

import {
  type ChatRequest,
  MAX_RETRIEVAL_QUERY_CHARS,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import { CLINICAL_WEIGHT, type ClinicalRanker } from './clinical.ts'
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
    options: {
      limit: number
      remedies?: readonly string[] | undefined
      prior?: readonly string[] | undefined
      priors?: readonly { ranking: readonly string[]; weight: number }[] | undefined
    },
  ): Promise<readonly RetrievedSource[]>
}

export class ProductionRetriever implements Retriever {
  readonly corpusVersion: string
  readonly #corpus: SearchableRelease
  readonly #embedder: QueryEmbedder
  readonly #repertory: Repertoriser | undefined
  readonly #candidates: number
  readonly #prior: boolean
  readonly #clinical: ClinicalRanker | undefined
  readonly #clinicalWeight: number

  /**
   * With a repertory, a question that describes a patient is searched only among the passages of
   * the remedies the repertory ranks highest for its symptoms, or, with `prior`, the whole corpus is
   * searched and the repertory's ranking is weighed with the books' support for each remedy. With
   * `prior` and `clinical`, Clarke's remedies for the diseases the case names are weighed with the
   * books' support beside the repertory's, at `clinicalWeight`.
   */
  constructor(
    corpus: SearchableRelease,
    embedder: QueryEmbedder,
    {
      repertory,
      candidates = CANDIDATE_REMEDIES,
      prior = false,
      clinical,
      clinicalWeight = CLINICAL_WEIGHT,
    }: {
      repertory?: Repertoriser | undefined
      candidates?: number
      prior?: boolean
      clinical?: ClinicalRanker | undefined
      clinicalWeight?: number
    } = {},
  ) {
    this.#corpus = corpus
    this.#embedder = embedder
    this.#repertory = repertory
    this.#candidates = candidates
    this.#prior = prior
    this.#clinical = clinical
    this.#clinicalWeight = clinicalWeight
    this.corpusVersion = corpus.corpusVersion
  }

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<readonly RetrievedSource[]> {
    // Earlier questions resolve follow-ups such as "what about its mental symptoms?". Answers are
    // left out: they are long enough to drown the question in both rankings.
    const questions = request.history.filter((turn) => turn.role === 'user').slice(-PREVIOUS_QUESTIONS)
    const query = [...questions.map((turn) => turn.content), request.message]
      .join('\n')
      .slice(-MAX_RETRIEVAL_QUERY_CHARS)
    const [embedding, ranking, clinical] = await Promise.all([
      this.#embed(query),
      this.#repertoryRanking(query),
      this.#clinicalRanking(query),
    ])
    if (this.#prior) {
      const priors = clinical ? [{ ranking: clinical, weight: this.#clinicalWeight }] : undefined
      return this.#corpus.search(query, embedding, { limit, prior: ranking, priors })
    }
    return this.#corpus.search(query, embedding, { limit, remedies: ranking?.slice(0, this.#candidates) })
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

  /** Clarke's remedies for the diseases the query names, best first, when weighing a prior. */
  async #clinicalRanking(query: string): Promise<readonly string[] | undefined> {
    if (!this.#clinical || !this.#prior) return undefined
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
      // The repertory only narrows or reorders the search; without it the corpus is searched as usual.
      console.error('Repertorisation failed; searching without it', error)
      return undefined
    }
  }
}
