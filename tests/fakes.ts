import type { Accounts, ChatStore, FeedbackStore } from '../src/server/accounts.ts'
import type { ChatSummary, Feedback, SavedChat, SavedConversation } from '../src/server/contracts.ts'
import type { Fetch } from '../src/server/http.ts'

export interface FetchCall {
  url: string
  method: string | undefined
  headers: Record<string, string>
  body: unknown
}

/** A fetch that replays the given responses in order and records each request. */
export function fakeFetch(...responses: (Response | Error)[]): Fetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  }
  return Object.assign(fetchImpl as Fetch, { calls })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A server-sent event stream with one `data:` line per event, delivered in the given chunks. */
export function sse(...events: unknown[]): Response {
  return stream(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`)
}

export function stream(...chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

export function timeout(): Error {
  return new DOMException('timeout secret', 'TimeoutError')
}

/** Chats kept in memory, keyed by user and chat. */
export class MemoryChatStore implements ChatStore {
  readonly users = new Map<string, Map<string, SavedChat>>()
  failure: Error | null = null

  #chats(userId: string) {
    if (this.failure) throw this.failure
    let chats = this.users.get(userId)
    if (!chats) this.users.set(userId, (chats = new Map()))
    return chats
  }

  async list(userId: string): Promise<ChatSummary[]> {
    return [...this.#chats(userId)]
      .map(([id, { title, updatedAt }]) => ({ id, title, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(userId: string, chatId: string): Promise<SavedConversation | null> {
    const chat = this.#chats(userId).get(chatId)
    return chat ? { messages: chat.messages, history: chat.history } : null
  }

  async put(userId: string, chatId: string, chat: SavedChat): Promise<number> {
    const chats = this.#chats(userId)
    const stored = chats.get(chatId)?.messages.length ?? 0
    chats.set(chatId, chat)
    return Math.max(0, chat.messages.length - stored)
  }

  async delete(userId: string, chatId: string) {
    this.#chats(userId).delete(chatId)
  }

  async deleteAll(userId: string) {
    this.#chats(userId)
    this.users.delete(userId)
  }
}

/** Ratings kept in memory, keyed by `userId/feedbackId`. */
export class MemoryFeedbackStore implements FeedbackStore {
  readonly saved = new Map<string, Feedback>()
  failure: Error | null = null

  async put(userId: string, feedbackId: string, feedback: Feedback) {
    if (this.failure) throw this.failure
    this.saved.set(`${userId}/${feedbackId}`, feedback)
  }

  async list(userId: string, chatId: string) {
    if (this.failure) throw this.failure
    const prefix = `${userId}/${chatId}-`
    const ratings = new Map<number, Feedback>()
    for (const [key, feedback] of this.saved) {
      const messageId = key.slice(prefix.length)
      if (key.startsWith(prefix) && /^\d+$/.test(messageId)) ratings.set(Number(messageId), feedback)
    }
    return ratings
  }
}

/** Accounts whose ID tokens are `token-<userId>`, or `token-<userId>-unverified` before email verification. */
export function fakeAccounts(
  chats = new MemoryChatStore(),
  feedback = new MemoryFeedbackStore(),
): Accounts & { chats: MemoryChatStore; feedback: MemoryFeedbackStore; deleted: string[] } {
  const deleted: string[] = []
  return {
    config: { apiKey: 'public-key', authDomain: 'test.firebaseapp.com', projectId: 'test' },
    chats,
    feedback,
    deleted,
    async user(idToken) {
      const match = idToken.match(/^token-(.+?)(-unverified)?$/)
      return match ? { id: match[1]!, verified: !match[2] } : undefined
    },
    async deleteUser(userId) {
      deleted.push(userId)
    },
  }
}
