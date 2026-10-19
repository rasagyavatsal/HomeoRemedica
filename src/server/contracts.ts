import { z } from 'zod'

export const MAX_TURN_CHARS = 4_000
export const MAX_HISTORY_TURNS = 20
export const MAX_HISTORY_CHARS = 16_000
export const MAX_RETRIEVAL_QUERY_CHARS = 8_000
export const DEFAULT_MODEL_INPUT_LIMIT_TOKENS = 8_192
export const MAX_CITATION_TEXT_CHARS = 8_000
export const MAX_GENERATION_PROMPT_CHARS = 64_000
export const MAX_GENERATED_ANSWER_CHARS = 12_000

function text(field: string) {
  return z
    .string({ error: `${field} must be a string` })
    .min(1, { error: `${field} must not be empty` })
    .max(MAX_TURN_CHARS, { error: `${field} must not exceed ${MAX_TURN_CHARS} characters` })
    .refine((value) => value.trim() !== '', { error: `${field} must not be blank` })
    .transform((value) => value.trim())
}

export const ChatTurnSchema = z.strictObject({
  role: z.enum(['user', 'assistant'], { error: 'role must be "user" or "assistant"' }),
  content: text('content'),
})

export const ChatRequestSchema = z
  .strictObject(
    {
      message: text('message'),
      history: z
        .array(ChatTurnSchema)
        .max(MAX_HISTORY_TURNS, { error: `history must not exceed ${MAX_HISTORY_TURNS} turns` })
        .default([]),
    },
    { error: (issue) => (issue.code === 'unrecognized_keys' ? 'unexpected request field' : undefined) },
  )
  .refine((request) => historyChars(request.history) <= MAX_HISTORY_CHARS, {
    error: `history must not exceed ${MAX_HISTORY_CHARS} characters`,
  })

export type ChatTurn = z.output<typeof ChatTurnSchema>
export type ChatRequest = z.output<typeof ChatRequestSchema>

export function historyChars(history: readonly ChatTurn[]): number {
  return history.reduce((total, turn) => total + turn.content.length, 0)
}

export interface BookSummary {
  bookId: string
  title: string
  author: string | null
}

export interface RetrievedSource {
  chunkId: string
  bookId: string
  bookTitle: string
  author: string | null
  remedyName: string
  sectionTitle: string
  passageIndexes: readonly number[]
  text: string
  score: number
}

export interface Citation {
  id: string
  bookId: string
  bookTitle: string
  author: string | null
  remedyName: string
  sectionTitle: string
  passageIndexes: readonly number[]
  text: string
}

export interface ChatResponse {
  answer: string
  corpusVersion: string
  model: string
  sources: readonly Citation[]
}

/** `GET /api/books` */
export interface BookCatalog {
  books: readonly BookSummary[]
  corpusVersion: string
  model: string
}

/** `POST /api/chat`: the answer plus the trimmed history to send with the next question. */
export interface WebChatResponse extends ChatResponse {
  history: ChatTurn[]
}

export interface Retriever {
  readonly corpusVersion: string
  readonly modelInputLimit?: number
  retrieve(request: ChatRequest, options: { limit: number }): Promise<readonly RetrievedSource[]>
}

export interface AnswerGenerator {
  readonly model: string
  generate(prompt: string, options: { systemInstruction: string }): Promise<string>
}
