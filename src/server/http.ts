/** JSON over fetch with a timeout, raising errors that never include provider responses. */

import { ProviderError, ProviderTimeoutError, isTimeout } from './errors.ts'

export type Fetch = typeof fetch

export async function send(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  { label, timeoutMs, signal }: { label: string; timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: signal ? AbortSignal.any([timeout, signal]) : timeout })
  } catch (error) {
    if (isTimeout(error)) throw new ProviderTimeoutError(`${label} request timed out`)
    throw new ProviderError(`${label} request failed`)
  }
}

export async function readJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (isTimeout(error)) throw new ProviderTimeoutError(`${label} request timed out`)
    throw new ProviderError(`${label} returned an invalid JSON response`)
  }
}

/** Yield each JSON `data:` payload of a server-sent event stream until `[DONE]`. */
export async function* readEvents(response: Response, label: string): AsyncGenerator<unknown> {
  if (!response.body) throw new ProviderError(`${label} returned an empty stream`)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>
      try {
        chunk = await reader.read()
      } catch (error) {
        if (isTimeout(error)) throw new ProviderTimeoutError(`${label} request timed out`)
        throw new ProviderError(`${label} stream failed`)
      }
      const lines = (buffer + (chunk.value ?? '')).split(/\r?\n/)
      // Keep a partial last line for the next chunk.
      buffer = chunk.done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        let event: unknown
        try {
          event = JSON.parse(data)
        } catch {
          throw new ProviderError(`${label} returned an invalid stream event`)
        }
        yield event
      }
      if (chunk.done) return
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
