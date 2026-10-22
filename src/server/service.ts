import {
  type AnswerGenerator,
  type ChatOptions,
  type ChatRequest,
  type ChatResponse,
  type Citation,
  MAX_CITATION_TEXT_CHARS,
  MAX_GENERATED_ANSWER_CHARS,
  MAX_GENERATION_PROMPT_CHARS,
  type RetrievedSource,
  type Retriever,
} from './contracts.ts'
import { ChatFailure, type FailureKind, ProviderError, TokenExhaustionError, isTimeout } from './errors.ts'
import { NO_SOURCES_ANSWER, SYSTEM_INSTRUCTION, generationPrompt } from './generation.ts'

/** Own the complete retrieve-and-generate sequence behind one narrow chat method. */
export class ChatService {
  readonly #retriever: Retriever
  readonly #generator: AnswerGenerator
  readonly #sourceLimit: number
  readonly #promptCharLimit: number

  // The default prompt limit, about 16,000 tokens at four characters per token, fits well within
  // the answer model's context window without needing a tokenizer in the serving container.
  constructor({
    retriever,
    generator,
    sourceLimit = 8,
    promptCharLimit = MAX_GENERATION_PROMPT_CHARS,
  }: {
    retriever: Retriever
    generator: AnswerGenerator
    sourceLimit?: number
    promptCharLimit?: number
  }) {
    this.#retriever = retriever
    this.#generator = generator
    this.#sourceLimit = sourceLimit
    this.#promptCharLimit = promptCharLimit
  }

  get corpusVersion(): string {
    return this.#retriever.corpusVersion
  }

  get modelName(): string {
    return this.#generator.model
  }

  async chat(request: ChatRequest, { onSources, onText, signal }: ChatOptions = {}): Promise<ChatResponse> {
    let sources: readonly RetrievedSource[]
    try {
      sources = await this.#retriever.retrieve(request, { limit: this.#sourceLimit })
    } catch (error) {
      if (error instanceof ChatFailure) throw error
      throw new ChatFailure({ stage: 'corpus_search', kind: isTimeout(error) ? 'timeout' : 'internal', cause: error })
    }
    // Reject an unusable corpus before paying for an answer.
    if (sources.some((source) => source.text.length > MAX_CITATION_TEXT_CHARS)) {
      throw new ChatFailure({ stage: 'chat', kind: 'internal', cause: new RangeError('citation text is too long') })
    }

    const corpusVersion = this.#retriever.corpusVersion
    const citations: Citation[] = sources.map((source) => ({
      id: `${corpusVersion}/${source.bookId}/${source.chunkId}`,
      bookId: source.bookId,
      bookTitle: source.bookTitle,
      author: source.author,
      remedyName: source.remedyName,
      sectionTitle: source.sectionTitle,
      passageIndexes: source.passageIndexes,
      text: source.text,
    }))
    onSources?.(citations)

    let generatedAnswer: string
    if (!sources.length) {
      // Without evidence the model could only decline, so skip the call.
      generatedAnswer = NO_SOURCES_ANSWER
      onText?.(generatedAnswer)
    } else {
      let streamed = 0
      try {
        generatedAnswer = (
          await this.#generator.generate(generationPrompt(request, sources, { maxChars: this.#promptCharLimit }), {
            systemInstruction: SYSTEM_INSTRUCTION,
            signal,
            // Stream no more than the answer limit; the final answer is authoritative.
            onText:
              onText &&
              ((text) => {
                const piece = text.slice(0, MAX_GENERATED_ANSWER_CHARS - streamed)
                streamed += piece.length
                if (piece) onText(piece)
              }),
          })
        ).trim()
      } catch (error) {
        if (error instanceof ChatFailure) throw error
        throw new ChatFailure({ stage: 'answer_generation', kind: generationFailureKind(error), cause: error })
      }
    }
    if (generatedAnswer.length > MAX_GENERATED_ANSWER_CHARS) {
      generatedAnswer = `${generatedAnswer.slice(0, MAX_GENERATED_ANSWER_CHARS).trimEnd()}…`
    }
    return {
      answer: generatedAnswer,
      corpusVersion,
      model: this.#generator.model,
      sources: citations,
    }
  }
}

function generationFailureKind(error: unknown): FailureKind {
  if (error instanceof TokenExhaustionError) return 'token_exhaustion'
  if (isTimeout(error)) return 'timeout'
  if (error instanceof ProviderError) return 'provider'
  return 'internal'
}
