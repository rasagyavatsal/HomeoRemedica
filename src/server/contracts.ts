import { z } from 'zod'

export const MAX_TURN_CHARS = 4_000
export const MAX_HISTORY_TURNS = 20
export const MAX_HISTORY_CHARS = 16_000
export const MAX_RETRIEVAL_QUERY_CHARS = 8_000
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
  /** Null for chunks about principles rather than a remedy, such as the Organon's. */
  remedyName: string | null
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
  /** Null for chunks about principles rather than a remedy, such as the Organon's. */
  remedyName: string | null
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

/** Optional progress callbacks for a chat request. */
export interface ChatOptions {
  /** Receives the citations once retrieval finishes, before any answer text. */
  onSources?: ((sources: readonly Citation[]) => void) | undefined
  /** Receives each piece of answer text as it is generated. */
  onText?: ((text: string) => void) | undefined
  signal?: AbortSignal | undefined
}

/** `GET /api/books` */
export interface BookCatalog {
  books: readonly BookSummary[]
}

/** `POST /api/chat`: the answer plus the trimmed history to send with the next question. */
export interface WebChatResponse extends ChatResponse {
  history: ChatTurn[]
}

/** The public Firebase settings the browser signs in with. */
export interface AuthConfig {
  apiKey: string
  authDomain: string
  projectId: string
}

/** `GET /api/config`: `auth` is null when this server has no accounts. */
export interface ClientConfig {
  auth: AuthConfig | null
}

export const MAX_SAVED_MESSAGES = 400
export const MAX_CHAT_TITLE_CHARS = 200
export const MAX_SAVED_SOURCES = 20
const MAX_SOURCE_FIELD_CHARS = 500

function field() {
  return z.string().max(MAX_SOURCE_FIELD_CHARS)
}

const SavedCitationSchema = z.strictObject({
  id: field(),
  bookId: field(),
  bookTitle: field(),
  author: field().nullable(),
  remedyName: field().nullable(),
  sectionTitle: field(),
  passageIndexes: z.array(z.number().int().nonnegative()).max(1_000),
  text: z.string().max(MAX_CITATION_TEXT_CHARS),
})

export const SavedMessageSchema = z.strictObject({
  id: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_GENERATED_ANSWER_CHARS),
  sources: z.array(SavedCitationSchema).max(MAX_SAVED_SOURCES).optional(),
})

/** `PUT /api/chats/:id`: the whole chat, as the browser shows it. */
export const SavedChatSchema = z.strictObject(
  {
    title: z.string().min(1).max(MAX_CHAT_TITLE_CHARS),
    updatedAt: z.number().int().nonnegative(),
    messages: z
      .array(SavedMessageSchema)
      .min(1)
      .max(MAX_SAVED_MESSAGES, { error: `a chat must not exceed ${MAX_SAVED_MESSAGES} messages` }),
    history: z.array(ChatTurnSchema).max(MAX_HISTORY_TURNS),
  },
  { error: (issue) => (issue.code === 'unrecognized_keys' ? 'unexpected chat field' : undefined) },
)

export type SavedMessage = z.output<typeof SavedMessageSchema>
export type SavedChat = z.output<typeof SavedChatSchema>

export interface ChatSummary {
  id: string
  title: string
  updatedAt: number
}

/** `GET /api/chats`, newest first. */
export interface ChatList {
  chats: ChatSummary[]
}

/** `GET /api/chats/:id` */
export interface SavedConversation {
  messages: SavedMessage[]
  history: ChatTurn[]
}

const RatingSchema = z.enum(['up', 'down'])

const RatedSourceSchema = z.strictObject({
  /** The citation id, `corpusVersion/bookId/chunkId`. */
  id: field(),
  /** Whether the answer cites this source. */
  cited: z.boolean(),
  rating: RatingSchema.nullable(),
})

/** `PUT /api/feedback/:id`: a user's rating of one answer and of its sources. */
export const FeedbackSchema = z.strictObject(
  {
    question: z.string().min(1).max(MAX_TURN_CHARS),
    answer: z.string().min(1).max(MAX_GENERATED_ANSWER_CHARS),
    rating: RatingSchema.nullable(),
    /** In the order they were retrieved, so a source's position is its rank. */
    sources: z.array(RatedSourceSchema).max(MAX_SAVED_SOURCES),
  },
  { error: (issue) => (issue.code === 'unrecognized_keys' ? 'unexpected feedback field' : undefined) },
)

export type Rating = z.output<typeof RatingSchema>
export type Feedback = z.output<typeof FeedbackSchema>

/** An answer's ratings: its own, and each source's by its number in the answer, from 1. */
export interface AnswerRatings {
  answer: Rating | null
  sources: Record<number, Rating>
}

/** `GET /api/chats/:id/feedback`: the user's ratings of the chat's answers, by message id. */
export interface ChatRatings {
  ratings: Record<number, AnswerRatings>
}

/** The ratings in an answer's feedback. */
export function answerRatings({ rating, sources }: Pick<Feedback, 'rating' | 'sources'>): AnswerRatings {
  const rated: Record<number, Rating> = {}
  for (const [index, source] of sources.entries()) {
    if (source.rating) rated[index + 1] = source.rating
  }
  return { answer: rating, sources: rated }
}

export interface Retriever {
  readonly corpusVersion: string
  retrieve(request: ChatRequest, options: { limit: number }): Promise<readonly RetrievedSource[]>
}

export interface GenerateOptions {
  systemInstruction: string
  /** Receives each piece of answer text as the provider streams it. */
  onText?: ((text: string) => void) | undefined
  signal?: AbortSignal | undefined
}

export interface AnswerGenerator {
  readonly model: string
  generate(prompt: string, options: GenerateOptions): Promise<string>
}
