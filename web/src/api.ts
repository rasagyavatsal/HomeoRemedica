export interface Book {
  bookId: string
  title: string
  author: string | null
}

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface Source {
  id: string
  bookId: string
  bookTitle: string
  author: string | null
  remedyName: string
  sectionTitle: string
  passageIndexes: number[]
  text: string
}

export interface BooksResponse {
  books: Book[]
  corpusVersion: string
  model: string
}

export interface ChatResponse {
  answer: string
  sources: Source[]
  corpusVersion: string
  model: string
  history: Turn[]
}

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

export async function sendMessage(message: string, history: Turn[], bookIds: string[] | null): Promise<ChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, bookIds }),
  })
  return readResponse<ChatResponse>(response)
}
