import { expect, it } from 'vitest'

import { RateLimiter } from '../src/server/rate-limit.ts'

function limiter() {
  let now = 0
  const rateLimiter = new RateLimiter(
    [
      { limit: 2, windowMs: 1_000 },
      { limit: 3, windowMs: 10_000 },
    ],
    { now: () => now },
  )
  return { rateLimiter, advance: (ms: number) => (now += ms) }
}

it('limits each client within every window', () => {
  const { rateLimiter, advance } = limiter()

  expect([rateLimiter.take('a'), rateLimiter.take('a')]).toEqual([undefined, undefined])
  expect(rateLimiter.take('a')).toBe(1)
  expect(rateLimiter.take('b')).toBeUndefined()

  advance(1_000)
  expect(rateLimiter.take('a')).toBeUndefined()
  advance(1_000)
  expect(rateLimiter.take('a')).toBe(8)

  advance(8_000)
  expect(rateLimiter.take('a')).toBeUndefined()
})

it('does not count rejected requests', () => {
  const { rateLimiter, advance } = limiter()
  rateLimiter.take('a')
  rateLimiter.take('a')
  rateLimiter.take('a')
  rateLimiter.take('a')

  advance(1_000)

  expect(rateLimiter.take('a')).toBeUndefined()
})
