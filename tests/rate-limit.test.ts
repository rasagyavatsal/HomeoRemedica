import { expect, it } from 'vitest'

import { RateLimiter, clientKey } from '../src/server/rate-limit.ts'

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

it('counts work by its size once it is done', () => {
  const { rateLimiter, advance } = limiter()

  expect(rateLimiter.wait('a')).toBeUndefined()
  rateLimiter.add('a', 2)
  expect(rateLimiter.wait('a')).toBe(1)
  expect(rateLimiter.wait('b')).toBeUndefined()

  advance(1_000)
  expect(rateLimiter.wait('a')).toBeUndefined()
  rateLimiter.add('a', 5)
  expect(rateLimiter.wait('a')).toBe(9)
})

it('keys IPv4 clients by address and IPv6 clients by /64', () => {
  expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
  expect(clientKey('2001:DB8:0:1::7')).toBe('2001:db8:0:1::/64')
  expect(clientKey('2001:0db8:0000:0001:ffff:0000:0000:0001')).toBe('2001:db8:0:1::/64')
  expect(clientKey('::1')).toBe('0:0:0:0::/64')
  expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
  expect(clientKey('direct')).toBe('direct')
})
