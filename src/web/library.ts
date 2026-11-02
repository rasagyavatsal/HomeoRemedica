/** Where saved chats live: this browser's storage, or the signed-in account. */

import type { ChatSummary, ChatTurn, SavedMessage } from '../server/contracts.ts'
import { ShownError } from './api.ts'
import { type Conversation, savedMessages } from './conversation.ts'

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
    return chat ? { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messages: chat.messages, history: chat.history } : null
  }

  async save(conversation: Conversation): Promise<ChatSummary> {
    const chat: StoredChat = { ...summarize(conversation), messages: savedMessages(conversation.messages), history: conversation.history }
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
