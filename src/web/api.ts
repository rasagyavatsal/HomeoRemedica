import type {
  BookCatalog,
  BookSummary,
  ChatList,
  ChatTurn,
  Citation,
  ClientConfig,
  WebChatResponse,
} from '../server/contracts.ts'
import type { ChatStore, ChatSummary, Conversation } from './chats'

// The browser shares the server's contract types; only types cross this boundary.
export type Book = BookSummary
export type Turn = ChatTurn
export type Source = Citation
export type BooksResponse = BookCatalog
export type ChatResponse = WebChatResponse

interface ValidationDetail {
  msg?: string
}

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body
      ? body.detail
      : undefined
    if (typeof detail === 'string') throw new Error(detail)
    if (Array.isArray(detail)) {
      const message = detail.map((item: ValidationDetail) => item?.msg).filter(Boolean).join(' ')
      if (message) throw new Error(message)
    }
    throw new Error('The request could not be completed. Please try again.')
  }
  if (!body || typeof body !== 'object') {
    throw new Error('The API returned an invalid response. Please try again.')
  }
  return body as T
}

export async function loadBooks(signal?: AbortSignal): Promise<BooksResponse> {
  const response = await fetch('/api/books', { signal })
  return readResponse<BooksResponse>(response)
}

/** The server's sign-in settings; a server without accounts, or an unreachable one, has none. */
export async function loadConfig(signal?: AbortSignal): Promise<ClientConfig> {
  const response = await fetch('/api/config', { signal })
  const config = await readResponse<Partial<ClientConfig>>(response)
  return { auth: config.auth ?? null }
}

/** Gives a current ID token for the signed-in account. */
export type TokenSource = () => Promise<string>

async function accountRequest(token: TokenSource, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token()}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function expectSuccess(response: Response) {
  if (!response.ok) await readResponse(response)
}

/** Chats saved to the signed-in account. */
export function accountChats(token: TokenSource): ChatStore {
  let chats: ChatSummary[] = []
  // Saves run one at a time, so an earlier copy of a chat never overwrites a later one.
  let saving = Promise.resolve()
  const chatPath = (id: string) => `/api/chats/${encodeURIComponent(id)}`
  return {
    async list() {
      chats = (await readResponse<ChatList>(await accountRequest(token, 'GET', '/api/chats'))).chats
      return chats
    },
    async load(id) {
      const response = await accountRequest(token, 'GET', chatPath(id))
      return response.status === 404 ? null : readResponse<Conversation>(response)
    },
    async save({ id, title, updatedAt, messages, history }) {
      const save = saving.then(async () => {
        await expectSuccess(await accountRequest(token, 'PUT', chatPath(id), { title, updatedAt, messages, history }))
      })
      saving = save.catch(() => {})
      await save
      chats = [{ id, title, updatedAt }, ...chats.filter((chat) => chat.id !== id)]
      return chats
    },
    async delete(id) {
      await expectSuccess(await accountRequest(token, 'DELETE', chatPath(id)))
      chats = chats.filter((chat) => chat.id !== id)
      return chats
    },
    async deleteAll() {
      await expectSuccess(await accountRequest(token, 'DELETE', '/api/chats'))
      chats = []
    },
  }
}

/** Delete the signed-in account and every chat saved to it. */
export async function deleteAccount(token: TokenSource): Promise<void> {
  await expectSuccess(await accountRequest(token, 'DELETE', '/api/account'))
}

export interface StreamHandlers {
  onSources?: (sources: readonly Source[]) => void
  onText?: (text: string) => void
}

/** Ask a question, reporting sources and answer text as the server streams them. */
export async function sendMessage(
  message: string,
  history: Turn[],
  { onSources, onText }: StreamHandlers = {},
): Promise<ChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message, history }),
  })
  // Errors raised before streaming starts, and servers that do not stream, answer with JSON.
  if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
    return readResponse<ChatResponse>(response)
  }
  for await (const { event, data } of readEvents(response.body)) {
    if (event === 'sources') onSources?.(data as Source[])
    else if (event === 'text') onText?.((data as { text: string }).text)
    else if (event === 'done') return data as ChatResponse
    else if (event === 'error') {
      const detail = (data as { detail?: unknown }).detail
      throw new Error(typeof detail === 'string' ? detail : 'The request could not be completed. Please try again.')
    }
  }
  throw new Error('The answer was interrupted. Please try again.')
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    // Keep a partial last event for the next chunk.
    buffer = done ? '' : blocks.pop() ?? ''
    for (const block of blocks) {
      let event = 'message'
      const data: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) yield { event, data: JSON.parse(data.join('\n')) }
    }
    if (done) return
  }
}
