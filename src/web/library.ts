/** Where saved chats live: this browser's storage, or the signed-in account. */

import type {
  AnswerRatings,
  ChatList,
  ChatRatings,
  ChatSummary,
  ChatTurn,
  Feedback,
  SavedChat,
  SavedConversation,
  SavedMessage,
} from '../server/contracts.ts'
import { ApiError, ShownError, failure } from './api.ts'
import { type Conversation, savedMessages, titleFrom } from './conversation.ts'

export interface ChatLibrary {
  /** Saved chats, newest first. */
  list(): Promise<ChatSummary[]>
  open(id: string): Promise<Conversation | null>
  save(conversation: Conversation): Promise<ChatSummary>
  remove(id: string): Promise<void>
}

export const MAX_LOCAL_CHATS = 50
const LIBRARY_KEY = 'homeoremedica.library.v1'
const OPEN_CHAT_KEY = 'homeoremedica.openChat'

interface StoredChat extends ChatSummary {
  messages: SavedMessage[]
  history: ChatTurn[]
  summary?: string
}

export function summarize({ id, title, updatedAt }: Conversation): ChatSummary {
  return { id, title, updatedAt }
}

/** Chats kept in this browser's local storage, at most `MAX_LOCAL_CHATS` of them. */
export class LocalLibrary implements ChatLibrary {
  readonly #storage: Storage | undefined

  constructor(storage: Storage | undefined = safeStorage('localStorage')) {
    this.#storage = storage
  }

  /** Every stored chat, newest first; unreadable entries are skipped. */
  all(): StoredChat[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(this.#storage?.getItem(LIBRARY_KEY) ?? '[]')
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredChat).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async list(): Promise<ChatSummary[]> {
    return this.all().map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
  }

  async open(id: string): Promise<Conversation | null> {
    const chat = this.all().find((stored) => stored.id === id)
    if (!chat) return null
    const { title, updatedAt, messages, history, summary } = chat
    return { id, title, updatedAt, messages, history, summary }
  }

  async save(conversation: Conversation): Promise<ChatSummary> {
    const chat: StoredChat = {
      ...summarize(conversation),
      messages: savedMessages(conversation.messages),
      history: conversation.history,
      summary: conversation.summary,
    }
    this.#write([chat, ...this.all().filter((stored) => stored.id !== chat.id)].slice(0, MAX_LOCAL_CHATS))
    return summarize(conversation)
  }

  async remove(id: string): Promise<void> {
    this.#write(this.all().filter((stored) => stored.id !== id))
  }

  /** Forget every chat, such as after moving them into an account. */
  clear(): void {
    this.#storage?.removeItem(LIBRARY_KEY)
  }

  /** Store the chats, dropping the oldest until they fit the browser's quota. */
  #write(chats: StoredChat[]): void {
    if (!this.#storage) throw new ShownError('This browser does not allow saving chats.')
    for (let kept = chats; ; kept = kept.slice(0, -1)) {
      try {
        this.#storage.setItem(LIBRARY_KEY, JSON.stringify(kept))
        // Nothing fit but an empty list: the new chat alone is too large.
        if (chats.length && !kept.length) break
        return
      } catch (error) {
        // Over quota: try again without the oldest chat.
        if (!kept.length) throw error
      }
    }
    throw new ShownError('This chat is too long to save in this browser.')
  }
}

/** Chats saved to the signed-in account through the API. */
export class AccountLibrary implements ChatLibrary {
  readonly #token: () => Promise<string>

  constructor(token: () => Promise<string>) {
    this.#token = token
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await this.#token()}`)
    const response = await fetch(path, { ...init, headers })
    if (!response.ok) throw await failure(response)
    return response
  }

  async list(): Promise<ChatSummary[]> {
    return ((await (await this.#request('/api/chats')).json()) as ChatList).chats
  }

  async open(id: string): Promise<Conversation | null> {
    let chat: SavedConversation
    try {
      chat = (await (await this.#request(`/api/chats/${encodeURIComponent(id)}`)).json()) as SavedConversation
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
    const title = chat.messages.find((message) => message.role === 'user')?.content ?? ''
    return {
      id,
      title: titleFrom(title),
      updatedAt: 0,
      messages: chat.messages,
      history: chat.history,
      summary: chat.summary,
    }
  }

  async save(conversation: Conversation): Promise<ChatSummary> {
    const chat: SavedChat = {
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages: savedMessages(conversation.messages),
      history: conversation.history,
      summary: conversation.summary,
    }
    const response = await this.#request(`/api/chats/${encodeURIComponent(conversation.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chat),
    })
    return (await response.json()) as ChatSummary
  }

  async remove(id: string): Promise<void> {
    await this.#request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  /** Save the ratings of one answer, replacing any sent for it before. */
  async rate(id: string, feedback: Feedback): Promise<void> {
    await this.#request(`/api/feedback/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
    })
  }

  /** The ratings saved for a chat's answers, by message id. */
  async ratings(chatId: string): Promise<Record<number, AnswerRatings>> {
    return ((await (await this.#request(`/api/chats/${encodeURIComponent(chatId)}/feedback`)).json()) as ChatRatings).ratings
  }

  /** Delete every chat and then the account itself. */
  async deleteAccount(): Promise<void> {
    await this.#request('/api/account', { method: 'DELETE' })
  }
}

/**
 * Move the chats saved in this browser into the account, removing each from the browser once
 * it is saved. Resolves with how many could not be moved; they stay in the browser.
 */
export async function moveIntoAccount(local: LocalLibrary, account: ChatLibrary): Promise<number> {
  let failed = 0
  for (const chat of local.all()) {
    try {
      await account.save(chat)
      await local.remove(chat.id)
    } catch {
      failed++
    }
  }
  return failed
}

function isStoredChat(value: unknown): value is StoredChat {
  if (typeof value !== 'object' || value === null) return false
  const chat = value as Partial<StoredChat>
  return (
    typeof chat.id === 'string' &&
    typeof chat.title === 'string' &&
    typeof chat.updatedAt === 'number' &&
    Array.isArray(chat.messages) &&
    Array.isArray(chat.history)
  )
}

/** The chat this tab had open, so a reload returns to it. */
export const openChat = {
  get(): string | null {
    return safeStorage('sessionStorage')?.getItem(OPEN_CHAT_KEY) ?? null
  },
  set(id: string | null): void {
    const storage = safeStorage('sessionStorage')
    try {
      if (id) storage?.setItem(OPEN_CHAT_KEY, id)
      else storage?.removeItem(OPEN_CHAT_KEY)
    } catch {
      // Not remembering the open chat only costs a reload its place.
    }
  },
}

// Reading `localStorage` throws when the browser blocks site data.
function safeStorage(name: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return window[name]
  } catch {
    return undefined
  }
}
