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
    const now = this.#now()
    if (this.#clients.size >= PRUNE_THRESHOLD) this.#prune(now)
    const windows = (this.#clients.get(client) ?? []).map((window) => (window.resetAt > now ? window : undefined))
    const current = this.#limits.map(({ windowMs }, index) => windows[index] ?? { count: 0, resetAt: now + windowMs })
    this.#clients.set(client, current)
    const exceeded = current.filter((window, index) => window.count >= this.#limits[index]!.limit)
    if (exceeded.length) return Math.ceil(Math.max(...exceeded.map((window) => window.resetAt - now)) / 1_000)
    for (const window of current) window.count++
    return undefined
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
