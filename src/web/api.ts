/** Browser client for the HomeoRemedica API. */

import type { BookCatalog, BookSummary, ChatTurn, Citation, WebChatResponse } from '../server/contracts.ts'

const FALLBACK_DETAIL = 'Something went wrong. Please try again.'
const INTERRUPTED_DETAIL = 'The answer stopped before it finished. Please try again.'

/** An error whose message is written for the reader. */
export class ShownError extends Error {
  override name = 'ShownError'
}

/** A failed request, with a message that is safe to show. */
export class ApiError extends ShownError {
  override name = 'ApiError'
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function failure(response: Response): Promise<ApiError> {
  let detail: unknown
  try {
    detail = ((await response.json()) as { detail?: unknown }).detail
  } catch {
    // Not JSON, such as a proxy's error page.
  }
  return new ApiError(typeof detail === 'string' && detail ? detail : FALLBACK_DETAIL, response.status)
}

/** A message to show for any error a request may throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ShownError) return error.message
  if (error instanceof TypeError) return 'The server could not be reached. Check your connection and try again.'
  return FALLBACK_DETAIL
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw await failure(response)
  return (await response.json()) as T
}

export async function loadBooks(): Promise<readonly BookSummary[]> {
  return (await getJson<BookCatalog>('/api/books')).books
}

export interface ChatQuestion {
  message: string
  history: readonly ChatTurn[]
}

export interface StreamHandlers {
  /** Receives the retrieved passages before any answer text. */
  onSources?: (sources: Citation[]) => void
  /** Receives each piece of the answer as it is generated. */
  onText?: (text: string) => void
}

/** Ask a question and stream the answer; resolves with the complete response. */
export async function streamChat(
  question: ChatQuestion,
  { onSources, onText }: StreamHandlers = {},
  signal?: AbortSignal,
): Promise<WebChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(question),
    signal,
  })
  if (!response.ok) throw await failure(response)
  if (!response.body) throw new ApiError(INTERRUPTED_DETAIL, response.status)

  for await (const { event, data } of readEvents(response.body)) {
    const payload: unknown = JSON.parse(data)
    switch (event) {
      case 'sources':
        onSources?.(payload as Citation[])
        break
      case 'text':
        onText?.((payload as { text: string }).text)
        break
      case 'done':
        return payload as WebChatResponse
      case 'error':
        throw new ApiError((payload as { detail?: string }).detail || FALLBACK_DETAIL, response.status)
    }
  }
  throw new ApiError(INTERRUPTED_DETAIL, response.status)
}

export interface ServerEvent {
  event: string
  data: string
}

/** Parse a server-sent event stream. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  // TypeScript's DOM types reject the decoder's BufferSource input for a byte stream.
  const reader = body.pipeThrough(new TextDecoderStream() as ReadableWritablePair<string, Uint8Array>).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      // An event ends at a blank line. Hold back a trailing \r: its \n may be in the next chunk.
      const usable = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      const blocks = usable.replace(/\r\n?/g, '\n').split('\n\n')
      buffer = (blocks.pop() ?? '') + buffer.slice(usable.length)
      for (const block of blocks) {
        const parsed = parseEvent(block)
        if (parsed) yield parsed
      }
    }
    const last = parseEvent(buffer.replace(/\r\n?/g, '\n'))
    if (last) yield last
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function parseEvent(block: string): ServerEvent | undefined {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length ? { event, data: data.join('\n') } : undefined
}
