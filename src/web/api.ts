import type { BookCatalog, BookSummary, ChatTurn, Citation, WebChatResponse } from '../server/contracts.ts'

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
