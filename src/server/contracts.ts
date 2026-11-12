import { z } from 'zod'

export const MAX_TURN_CHARS = 4_000
export const MAX_HISTORY_TURNS = 20
export const MAX_HISTORY_CHARS = 16_000
export const MAX_RETRIEVAL_QUERY_CHARS = 8_000
export const MAX_CITATION_TEXT_CHARS = 8_000
export const MAX_GENERATION_PROMPT_CHARS = 64_000
export const MAX_GENERATED_ANSWER_CHARS = 12_000
/** How many symptoms a case is searched by, at most. */
export const MAX_SYMPTOMS = 15
export const MAX_SYMPTOM_CHARS = 200

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
      history: historySchema().default([]),
      summary: text('summary').optional(),
      /** The case's symptoms as the user confirmed them, searched in place of the model's own. */
      symptoms: z
        .array(
          z
            .string({ error: 'a symptom must be a string' })
            .trim()
            .min(1, { error: 'a symptom must not be blank' })
            .max(MAX_SYMPTOM_CHARS, { error: `a symptom must not exceed ${MAX_SYMPTOM_CHARS} characters` }),
          { error: 'symptoms must be a list' },
        )
        .max(MAX_SYMPTOMS, { error: `symptoms must not exceed ${MAX_SYMPTOMS}` })
        .optional(),
    },
    { error: (issue) => (issue.code === 'unrecognized_keys' ? 'unexpected request field' : undefined) },
  )
  .refine((request) => contextChars(request.history, request.summary) <= MAX_HISTORY_CHARS, {
    error: `history must not exceed ${MAX_HISTORY_CHARS} characters`,
  })

function historySchema() {
  return z.array(ChatTurnSchema).max(MAX_HISTORY_TURNS, { error: `history must not exceed ${MAX_HISTORY_TURNS} turns` })
}

/** The latest exchange, which compaction keeps word for word so follow-ups still resolve. */
export const KEPT_TURNS = 2

/** `POST /api/chat/compact`: the context to condense into a summary. */
export const CompactRequestSchema = z
  .strictObject(
    { history: historySchema(), summary: text('summary').optional() },
    { error: (issue) => (issue.code === 'unrecognized_keys' ? 'unexpected request field' : undefined) },
  )
  .refine((request) => contextChars(request.history, request.summary) <= MAX_HISTORY_CHARS, {
    error: `history must not exceed ${MAX_HISTORY_CHARS} characters`,
  })
  .refine((request) => request.history.length > KEPT_TURNS, { error: 'there is nothing to compact' })

export type ChatTurn = z.output<typeof ChatTurnSchema>
export type ChatRequest = z.output<typeof ChatRequestSchema>
export type CompactRequest = z.output<typeof CompactRequestSchema>

export function historyChars(history: readonly ChatTurn[]): number {
  return history.reduce((total, turn) => total + turn.content.length, 0)
}

/** The characters the model reads from earlier in the chat: the summary and the history. */
export function contextChars(history: readonly ChatTurn[], summary: string | undefined): number {
  return historyChars(history) + (summary?.length ?? 0)
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
  /** Null for chunks about principles rather than a remedy, such as the Organon's, and for rubrics. */
  remedyName: string | null
  sectionTitle: string
  passageIndexes: readonly number[]
  text: string
  /** The passage's fused search score; 0 for a rubric, which the search does not rank. */
  score: number
}

/** A remedy that the repertories or Clarke's Clinical sections rank among the first for a case. */
export interface RankedRemedy {
  remedyName: string
  /**
   * The case's symptoms the remedy covers, or the diseases Clarke lists it for. `source` is the
   * place, from 1, of the rubric among the retrieved sources that lists the remedy for a symptom.
   */
  matched: readonly { text: string; source?: number }[]
}

/** What an answer is generated from. */
export interface Retrieval {
  /** The books' passages, then the repertory rubrics that `repertory` points to. */
  sources: readonly RetrievedSource[]
  /** The repertories' leading remedies, best first; empty when they rank none for the question. */
  repertory: readonly RankedRemedy[]
  /** Clarke's leading remedies, best first; empty when he ranks none for the question. */
  clinical: readonly RankedRemedy[]
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

/** The corpus every answer cites; it leads each citation id. */
export const CORPUS_VERSION = 'homeoremedica'

export interface ChatResponse {
  answer: string
  corpusVersion: string
  model: string
  sources: readonly Citation[]
  /** The context a nearly full chat was condensed into before it was answered. */
  compacted?: CompactResponse
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

/** Whether a question describes a patient, whose symptoms are read, or asks about anything else. */
export type QuestionKind = 'case' | 'question'

/** `POST /api/kind`: decided before a question is answered, so only a case is read for symptoms. */
export interface KindResponse {
  kind: QuestionKind
}

/** `POST /api/symptoms`: the symptoms of the case a question describes; none when it describes no patient. */
export interface SymptomsResponse {
  symptoms: string[]
}

/** `POST /api/chat`: the answer plus the trimmed history and the summary to send with the next question. */
export interface WebChatResponse extends Omit<ChatResponse, 'compacted'> {
  history: ChatTurn[]
  /** What the chat's earlier turns were condensed into, now or before. */
  summary?: string
}

/** A chat's context once condensed; also what `POST /api/chat/compact` answers released Android builds. */
export interface CompactResponse {
  summary: string
  history: ChatTurn[]
}

/** The public Firebase settings the browser signs in with. */
export interface AuthConfig {
  apiKey: string
  authDomain: string
  projectId: string
  /** The Firebase Auth emulator's URL, which only the end-to-end test server sets. */
  emulator?: string
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
    /** What compacting the chat condensed its earlier turns into. */
    summary: z.string().max(MAX_TURN_CHARS).optional(),
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
  summary?: string
}

const RatingSchema = z.enum(['up', 'down'])
const FeedbackReasonSchema = z.enum(['wrong_remedy', 'irrelevant_sources', 'missing_information', 'unclear'])

export const MAX_FEEDBACK_COMMENT_CHARS = 1_000

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
    // Both default for pages loaded before they existed.
    /** What was wrong with an answer rated down. */
    reasons: z
      .array(FeedbackReasonSchema)
      .refine((reasons) => new Set(reasons).size === reasons.length, { error: 'reasons must not repeat' })
      .default([]),
    comment: z
      .string()
      .max(MAX_FEEDBACK_COMMENT_CHARS, { error: `comment must not exceed ${MAX_FEEDBACK_COMMENT_CHARS} characters` })
      .nullable()
      .default(null)
      .transform((comment) => comment?.trim() || null),
  },
  { error: (issue) => (issue.code === 'unrecognized_keys' ? 'unexpected feedback field' : undefined) },
).refine((feedback) => feedback.rating === 'down' || !feedback.reasons.length, {
  error: 'only an answer rated down has reasons',
})

export type Rating = z.output<typeof RatingSchema>
export type FeedbackReason = z.output<typeof FeedbackReasonSchema>
export type Feedback = z.output<typeof FeedbackSchema>

/** An answer's ratings: its own, each source's by its number in the answer from 1, and why. */
export interface AnswerRatings {
  answer: Rating | null
  sources: Record<number, Rating>
  reasons: FeedbackReason[]
  comment: string | null
}

/** `GET /api/chats/:id/feedback`: the user's ratings of the chat's answers, by message id. */
export interface ChatRatings {
  ratings: Record<number, AnswerRatings>
}

/** The parts of feedback that `answerRatings` reads. */
export type SavedRatings = Pick<Feedback, 'rating' | 'sources' | 'reasons' | 'comment'>

/** The ratings in an answer's feedback. */
export function answerRatings({ rating, sources, reasons, comment }: SavedRatings): AnswerRatings {
  const rated: Record<number, Rating> = {}
  for (const [index, source] of sources.entries()) {
    if (source.rating) rated[index + 1] = source.rating
  }
  return { answer: rating, sources: rated, reasons, comment }
}

export interface Retriever {
  /** `limit` bounds the books' passages; the rubrics come on top of it. */
  retrieve(request: ChatRequest, options: { limit: number }): Promise<Retrieval>
  /** Whether a question describes a patient; a `question` has no symptoms to read. */
  kind(request: ChatRequest): Promise<QuestionKind>
  /** The symptoms a question's case would be searched by, for the user to check first. */
  symptoms(request: ChatRequest): Promise<string[]>
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
