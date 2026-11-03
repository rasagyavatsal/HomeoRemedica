/** Per-client request limits, kept in memory for one server instance. */

import { isIPv6 } from 'node:net'

export interface RateLimit {
  limit: number
  windowMs: number
}

// Enough for a person reading answers; a script hitting the paid providers is stopped quickly.
export const CHAT_RATE_LIMITS: readonly RateLimit[] = [
  { limit: 10, windowMs: 60_000 },
  { limit: 100, windowMs: 60 * 60_000 },
]

// Questions from every client together, so many addresses cannot run up provider spend.
export const TOTAL_CHAT_RATE_LIMITS: readonly RateLimit[] = [{ limit: 1_000, windowMs: 24 * 60 * 60_000 }]

// Messages each signed-in user may save. Asking questions at the chat limits adds about 200 an
// hour; the rest leaves room for moving a browser's chats into the account at sign-in.
export const CHAT_SAVE_RATE_LIMITS: readonly RateLimit[] = [
  { limit: 1_000, windowMs: 60 * 60_000 },
  { limit: 5_000, windowMs: 24 * 60 * 60_000 },
]

// Ratings each signed-in user may send. Every click on a thumb sends one, so a person rating
// every answer and source stays far below these.
export const FEEDBACK_RATE_LIMITS: readonly RateLimit[] = [
  { limit: 60, windowMs: 60_000 },
  { limit: 2_000, windowMs: 24 * 60 * 60_000 },
]

// Forget expired clients once this many are tracked.
const PRUNE_THRESHOLD = 10_000

interface Window {
  count: number
  resetAt: number
}

export class RateLimiter {
  readonly #limits: readonly RateLimit[]
  readonly #now: () => number
  readonly #clients = new Map<string, Window[]>()

  constructor(limits: readonly RateLimit[] = CHAT_RATE_LIMITS, { now = Date.now }: { now?: () => number } = {}) {
    this.#limits = limits
    this.#now = now
  }

  /** Count a request from `client`, or return the seconds it must wait when over a limit. */
  take(client: string): number | undefined {
    const retryAfter = this.wait(client)
    if (retryAfter === undefined) this.add(client)
    return retryAfter
  }

  /** The seconds `client` must wait while it is over a limit, or undefined when it may go ahead. */
  wait(client: string): number | undefined {
    const now = this.#now()
    const exceeded = this.#windows(client, now).filter((window, index) => window.count >= this.#limits[index]!.limit)
    if (!exceeded.length) return undefined
    return Math.ceil(Math.max(...exceeded.map((window) => window.resetAt - now)) / 1_000)
  }

  /** Count `amount` against `client`, for work whose size is known only once it is done. */
  add(client: string, amount = 1) {
    for (const window of this.#windows(client, this.#now())) window.count += amount
  }

  #windows(client: string, now: number): Window[] {
    if (this.#clients.size >= PRUNE_THRESHOLD) this.#prune(now)
    const windows = (this.#clients.get(client) ?? []).map((window) => (window.resetAt > now ? window : undefined))
    const current = this.#limits.map(({ windowMs }, index) => windows[index] ?? { count: 0, resetAt: now + windowMs })
    this.#clients.set(client, current)
    return current
  }

  #prune(now: number) {
    for (const [client, windows] of this.#clients) {
      if (windows.every((window) => window.resetAt <= now)) this.#clients.delete(client)
    }
  }
}

/**
 * The key a client is limited by. One IPv6 connection usually holds a whole /64, so its addresses
 * share a key; an IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function clientKey(address: string): string {
  if (!isIPv6(address)) return address
  let canonical: string
  try {
    canonical = new URL(`http://[${address}]`).hostname.slice(1, -1)
  } catch {
    // A zone ID such as `fe80::1%eth0` is only ever local.
    return address
  }
  const [head = '', tail = ''] = canonical.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  if (groups.slice(0, 6).join(':') === '0:0:0:0:0:ffff') {
    return groups
      .slice(6)
      .flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 0xff])
      .join('.')
  }
  return `${groups.slice(0, 4).join(':')}::/64`
}
