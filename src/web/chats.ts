/** Past chats saved in this browser's localStorage. Nothing here reaches the server. */

import type { Source, Turn } from './api'

export interface Message extends Turn {
  id: number
  sources?: readonly Source[]
}

export interface Conversation {
  messages: Message[]
  history: Turn[]
}

export interface ChatSummary {
  id: string
  title: string
  updatedAt: number
}

export interface StoredChat extends ChatSummary, Conversation {}

/** The list of chats, newest first. Other tabs watch this key to refresh their sidebars. */
export const INDEX_KEY = 'homeoremedica:chats'
const CHAT_PREFIX = 'homeoremedica:chat:'
/** The chat this tab has open, kept per tab so a reload reopens it and new tabs start fresh. */
const OPEN_KEY = 'homeoremedica:open-chat'
/** Where the single conversation was kept before chats were saved in localStorage. */
const LEGACY_KEY = 'homeoremedica:conversation'
const VERSION = 1
export const MAX_CHATS = 50
const MAX_TITLE_CHARS = 80

function read(storage: Storage, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null')
  } catch {
    // Blocked storage or unreadable data counts as nothing saved.
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isConversation(value: unknown): value is Conversation {
  return isRecord(value) && Array.isArray(value.messages) && Array.isArray(value.history)
}

function isSummary(value: unknown): value is ChatSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.updatedAt === 'number'
}

/** The first question, on one line and short enough for the sidebar. */
export function chatTitle(messages: readonly Message[]): string {
  const question = messages.find((message) => message.role === 'user')?.content ?? ''
  const line = question.replace(/\s+/g, ' ').trim() || 'Untitled chat'
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

/** Saved chats, newest first. */
export function listChats(): ChatSummary[] {
  const index = read(localStorage, INDEX_KEY)
  if (!isRecord(index) || index.version !== VERSION || !Array.isArray(index.chats)) return []
  return index.chats.filter(isSummary).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadChat(id: string): Conversation | null {
  const chat = read(localStorage, CHAT_PREFIX + id)
  return isRecord(chat) && chat.version === VERSION && isConversation(chat)
    ? { messages: chat.messages, history: chat.history }
    : null
}

function writeIndex(chats: readonly ChatSummary[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify({ version: VERSION, chats }))
}

function removeChat(id: string) {
  localStorage.removeItem(CHAT_PREFIX + id)
}

/**
 * Save a chat and move it to the top of the list, returning the new list. The oldest chats
 * make room when there are too many or storage is full; the chat being saved is never dropped.
 */
export function saveChat({ id, title, updatedAt, messages, history }: StoredChat): ChatSummary[] {
  let chats = [{ id, title, updatedAt }, ...listChats().filter((chat) => chat.id !== id)]
  try {
    for (const dropped of chats.splice(MAX_CHATS)) removeChat(dropped.id)
    for (;;) {
      try {
        localStorage.setItem(CHAT_PREFIX + id, JSON.stringify({ version: VERSION, messages, history }))
        writeIndex(chats)
        return chats
      } catch (error) {
        if (!isQuotaError(error) || chats.length < 2) throw error
        removeChat(chats.pop()!.id)
      }
    }
  } catch {
    // Blocked storage, or one chat larger than storage, keeps the chat in this tab only.
    chats = listChats()
    return chats.some((chat) => chat.id === id) ? chats : [{ id, title, updatedAt }, ...chats]
  }
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException
    && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
}

/** Delete one chat, returning the list without it. */
export function deleteChat(id: string): ChatSummary[] {
  const chats = listChats().filter((chat) => chat.id !== id)
  try {
    removeChat(id)
    writeIndex(chats)
  } catch {
    // Blocked storage has nothing saved to delete.
  }
  return chats
}

export function deleteAllChats() {
  try {
    for (const chat of listChats()) removeChat(chat.id)
    localStorage.removeItem(INDEX_KEY)
  } catch {
    // Blocked storage has nothing saved to delete.
  }
}

export function openChatId(): string | null {
  const id = read(sessionStorage, OPEN_KEY)
  return typeof id === 'string' ? id : null
}

export function rememberOpenChat(id: string | null) {
  try {
    if (id) sessionStorage.setItem(OPEN_KEY, JSON.stringify(id))
    else sessionStorage.removeItem(OPEN_KEY)
  } catch {
    // Without storage a reload starts a new chat.
  }
}

/** Move a conversation saved by an earlier version into the saved chats and open it. */
export function migrateLegacyConversation() {
  const legacy = read(sessionStorage, LEGACY_KEY)
  try {
    sessionStorage.removeItem(LEGACY_KEY)
  } catch {
    return
  }
  if (!isConversation(legacy) || !legacy.messages.length) return
  const id = crypto.randomUUID()
  saveChat({ id, title: chatTitle(legacy.messages), updatedAt: Date.now(), ...legacy })
  rememberOpenChat(id)
}
