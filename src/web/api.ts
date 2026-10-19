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

export async function sendMessage(message: string, history: Turn[]): Promise<ChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  })
  return readResponse<ChatResponse>(response)
}
