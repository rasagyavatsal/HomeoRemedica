/** Production query embedding and corpus search. */

import {
  type Cancellable,
  type ChatRequest,
  MAX_RETRIEVAL_QUERY_CHARS,
  type QuestionKind,
  type Retrieval,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import { type ClinicalMatch, type ClinicalRanker, decisiveMatch, leadingClinicalRemedies } from './clinical.ts'
import { type Repertorisation, type Repertoriser, decisive, leadingRemedies } from './repertory.ts'

const PREVIOUS_QUESTIONS = 2

export interface QueryEmbedder {
  embedQuery(text: string): Promise<readonly number[]>
}

export interface SearchableRelease {
  search(
    query: string,
    embedding: readonly number[],
    options: { limit: number; priors?: readonly (readonly string[])[] | undefined },
  ): Promise<readonly RetrievedSource[]>
}

export class ProductionRetriever implements Retriever {
  readonly #corpus: SearchableRelease
  readonly #embedder: QueryEmbedder
  readonly #repertory: Repertoriser | undefined
  readonly #clinical: ClinicalRanker | undefined

  /**
   * The whole corpus is searched. With a repertory, its ranking of remedies for the symptoms of a
   * question that describes a patient is fused with the books' support for each remedy. With
   * `clinical`, Clarke's remedies for the diseases the case names are fused beside it. The
   * rankings and the books' support all count the same. A ranking that many remedies lead together
   * at a low score is left out. The leading remedies of each ranking are returned with the
   * passages, and the rubrics behind the repertories' as further sources.
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
  }

  async retrieve(request: ChatRequest, { limit }: { limit: number }): Promise<Retrieval> {
    // Earlier questions resolve follow-ups such as "what about its mental symptoms?". Answers are
    // left out: they are long enough to drown the question in both rankings.
    const query = searchQuery(request)
    const [embedding, repertorisation, match] = await Promise.all([
      this.#embedder.embedQuery(query),
      this.#repertorisation(query, request.symptoms),
      this.#clinicalMatch(query),
    ])
    const priors = [repertorisation?.remedies.map((remedy) => remedy.remedyId), match?.ranking].filter(
      (ranking) => ranking !== undefined,
    )
    const passages = await this.#corpus.search(query, embedding, { limit, priors })
    const { remedies, rubrics } = repertorisation
      ? leadingRemedies(repertorisation, { firstSource: passages.length + 1 })
      : { remedies: [], rubrics: [] }
    return {
      sources: [...passages, ...rubrics],
      repertory: remedies,
      clinical: match ? leadingClinicalRemedies(match) : [],
    }
  }

  async kind(request: ChatRequest, options?: Cancellable): Promise<QuestionKind> {
    return this.#repertory ? this.#repertory.kind(searchQuery(request), options) : 'question'
  }

  async symptoms(request: ChatRequest, options?: Cancellable): Promise<string[]> {
    return this.#repertory ? this.#repertory.symptoms(searchQuery(request), options) : []
  }

  /** Clarke's remedies for the diseases the query names, if they tell remedies apart. */
  async #clinicalMatch(query: string): Promise<ClinicalMatch | undefined> {
    if (!this.#clinical) return undefined
    try {
      const match = await this.#clinical.rank(query)
      return decisiveMatch(match) ? match : undefined
    } catch (error) {
      // Like the repertory, Clarke's terms only reorder the search.
      console.error("Matching Clarke's clinical terms failed; searching without them", error)
      return undefined
    }
  }

  /**
   * The repertorisation of the case the query describes, if it describes one and tells remedies
   * apart; of `symptoms` when the user confirmed them.
   */
  async #repertorisation(query: string, symptoms: readonly string[] | undefined): Promise<Repertorisation | undefined> {
    if (!this.#repertory) return undefined
    try {
      const repertorisation = await this.#repertory.repertorise(query, symptoms)
      return decisive(repertorisation) ? repertorisation : undefined
    } catch (error) {
      // The repertory only reorders the search; without it the corpus is searched as usual.
      console.error('Repertorisation failed; searching without it', error)
      return undefined
    }
  }
}

/** The question with the ones before it, as the books and the repertories are searched. */
function searchQuery(request: ChatRequest): string {
  const questions = request.history.filter((turn) => turn.role === 'user').slice(-PREVIOUS_QUESTIONS)
  return [...questions.map((turn) => turn.content), request.message].join('\n').slice(-MAX_RETRIEVAL_QUERY_CHARS)
}
