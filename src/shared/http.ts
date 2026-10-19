/** JSON over fetch with a timeout, raising errors that never include provider responses. */

import { ProviderError, ProviderTimeoutError, isTimeout } from './errors.ts'

export type Fetch = typeof fetch

export async function send(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
  { label, timeoutMs }: { label: string; timeoutMs: number },
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
