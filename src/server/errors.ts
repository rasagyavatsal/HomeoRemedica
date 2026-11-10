export type FailureKind = 'timeout' | 'provider' | 'token_exhaustion' | 'internal'

export const FAILURE_DETAILS: Record<FailureKind, string> = {
  timeout: 'The request took too long. Please try again.',
  provider: 'The chat provider is temporarily unavailable. Please try again shortly.',
  token_exhaustion: 'Response limit reached. Please try again.',
  internal: 'Something went wrong while preparing the answer. Please try again.',
}

/** Required settings are missing or invalid. */
export class ConfigurationError extends Error {
  override name = 'ConfigurationError'
}

/** An external provider failed or returned an unusable response. */
export class ProviderError extends Error {
  override name = 'ProviderError'
}

/** An external provider did not answer in time. */
export class ProviderTimeoutError extends Error {
  override name = 'ProviderTimeoutError'
}

/** The answer provider stopped because it reached the output token limit. */
export class TokenExhaustionError extends Error {
  override name = 'TokenExhaustionError'

  constructor() {
    super('chat response reached the output token limit')
  }
}

export function isTimeout(error: unknown): boolean {
  // fetch rejects with a DOMException named TimeoutError when AbortSignal.timeout fires.
  return error instanceof ProviderTimeoutError || (error instanceof Error && error.name === 'TimeoutError')
}
