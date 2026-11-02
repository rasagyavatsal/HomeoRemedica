import type { Citation, WebChatResponse } from '../../server/contracts.ts'

export function citation(number: number, overrides: Partial<Citation> = {}): Citation {
  return {
    id: `v1/boericke_mm/${number}`,
    bookId: 'boericke_mm',
    bookTitle: 'Boericke, Homoeopathic Materia Medica',
    author: 'William Boericke',
    remedyName: `Remedy ${number}`,
    sectionTitle: 'Mind',
    passageIndexes: [number],
    text: `Passage ${number} text.`,
    ...overrides,
  }
}

export function chatResponse(answer: string, sources: Citation[], question = 'Question?'): WebChatResponse {
  return {
    answer,
    sources,
    corpusVersion: 'v1',
    model: 'test-model',
    history: [
      { role: 'user', content: question },
      { role: 'assistant', content: answer },
    ],
  }
}

/** A server-sent event stream; each string is sent as its own chunk. */
export function eventStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** A streamed answer, as `/api/chat` sends it. */
export function answerStream(answer: string, sources: Citation[], question?: string): Response {
  const pieces = answer.match(/.{1,12}/gs) ?? []
  return new Response(
    eventStream([
      sse('sources', sources),
      ...pieces.map((text) => sse('text', { text })),
      sse('done', chatResponse(answer, sources, question)),
    ]),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** A response that never arrives until `signal` aborts. */
export function pending(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
}
