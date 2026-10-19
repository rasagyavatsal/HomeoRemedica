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

export function timeout(): Error {
  return new DOMException('timeout secret', 'TimeoutError')
}
