import { describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/server/app.ts'
import { type Feedback, MAX_SAVED_MESSAGES, type SavedChat } from '../src/server/contracts.ts'
import { RateLimiter } from '../src/server/rate-limit.ts'
import { fakeAccounts } from './fakes.ts'

const unexpected = () => {
  throw new Error('saved chats must not initialize chat')
}

function setup(saveRateLimiter: RateLimiter | null = null, feedbackRateLimiter: RateLimiter | null = null) {
  const accounts = fakeAccounts()
  const app = createApp(
    { getService: unexpected, getAccounts: () => accounts },
    { webDist: null, rateLimiter: null, saveRateLimiter, feedbackRateLimiter },
  )
  const request = (method: string, path: string, { user = 'alice', body }: { user?: string | null; body?: unknown } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(user ? { Authorization: `Bearer token-${user}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { app, accounts, request }
}

function chat(question: string, updatedAt = 1_000): SavedChat {
  return {
    title: question,
    updatedAt,
    messages: [
      { id: 0, role: 'user', content: question },
      { id: 1, role: 'assistant', content: `Answer to ${question}`, sources: [] },
    ],
    history: [{ role: 'user', content: question }, { role: 'assistant', content: `Answer to ${question}` }],
  }
}

const read = (response: Response): Promise<any> => response.json()

describe('client config', () => {
  it('offers the public Firebase settings when accounts are configured', async () => {
    const { app, accounts } = setup()

    expect(await read(await app.request('/api/config'))).toEqual({ auth: accounts.config })
  })

  it('has no sign-in when accounts are not configured', async () => {
    const app = createApp({ getService: unexpected }, { webDist: null, rateLimiter: null })

    expect(await read(await app.request('/api/config'))).toEqual({ auth: null })
    const response = await app.request('/api/chats', { headers: { Authorization: 'Bearer token-alice' } })
    expect(response.status).toBe(503)
  })
})

describe('saved chats', () => {
  it('needs a valid sign-in', async () => {
    const { request } = setup()

    for (const response of [
      await request('GET', '/api/chats', { user: null }),
      await request('GET', '/api/chats', { user: '' }),
      await request('DELETE', '/api/account', { user: null }),
    ]) {
      expect(response.status).toBe(401)
      expect(await read(response)).toEqual({ detail: 'Please sign in again.' })
    }
  })

  it('saves, lists, opens and deletes chats', async () => {
    const { request } = setup()

    const saved = await request('PUT', '/api/chats/chat-1', { body: chat('Arsenicum keynotes', 1_000) })
    expect(await read(saved)).toEqual({ id: 'chat-1', title: 'Arsenicum keynotes', updatedAt: 1_000 })
    await request('PUT', '/api/chats/chat-2', { body: chat('Bryonia keynotes', 2_000) })

    expect(await read(await request('GET', '/api/chats'))).toEqual({
      chats: [
        { id: 'chat-2', title: 'Bryonia keynotes', updatedAt: 2_000 },
        { id: 'chat-1', title: 'Arsenicum keynotes', updatedAt: 1_000 },
      ],
    })
    const opened = await read(await request('GET', '/api/chats/chat-1'))
    expect(opened).toEqual({ messages: chat('Arsenicum keynotes').messages, history: chat('Arsenicum keynotes').history })

    expect((await request('DELETE', '/api/chats/chat-1')).status).toBe(204)
    expect((await request('GET', '/api/chats/chat-1')).status).toBe(404)
    expect((await request('DELETE', '/api/chats')).status).toBe(204)
    expect(await read(await request('GET', '/api/chats'))).toEqual({ chats: [] })
  })

  it('keeps each user to their own chats', async () => {
    const { request } = setup()
    await request('PUT', '/api/chats/chat-1', { body: chat('Private question') })

    expect(await read(await request('GET', '/api/chats', { user: 'bob' }))).toEqual({ chats: [] })
    expect((await request('GET', '/api/chats/chat-1', { user: 'bob' })).status).toBe(404)
    await request('DELETE', '/api/chats/chat-1', { user: 'bob' })
    expect((await request('GET', '/api/chats/chat-1')).status).toBe(200)
  })

  it('does not date a chat in the future', async () => {
    const { request } = setup()
    vi.spyOn(Date, 'now').mockReturnValue(5_000)

    expect((await read(await request('PUT', '/api/chats/chat-1', { body: chat('Question', 9_999) }))).updatedAt).toBe(5_000)
  })

  it.each([
    ['an unexpected field', { ...chat('Question'), secret: true }],
    ['no messages', { ...chat('Question'), messages: [] }],
    ['too many messages', { ...chat('Question'), messages: Array.from({ length: MAX_SAVED_MESSAGES + 1 }, (_, id) => ({ id, role: 'user', content: 'Q' })) }],
    ['a bad role', { ...chat('Question'), messages: [{ id: 0, role: 'system', content: 'Q' }] }],
  ])('rejects a chat with %s', async (_, body) => {
    const { request, accounts } = setup()

    const response = await request('PUT', '/api/chats/chat-1', { body })

    expect(response.status).toBe(422)
    expect(typeof (await read(response)).detail).toBe('string')
    expect(accounts.chats.users.size).toBe(0)
  })

  it('saves only for a verified email, but still lists and deletes', async () => {
    const { request, accounts } = setup()

    const response = await request('PUT', '/api/chats/chat-1', { user: 'bob-unverified', body: chat('Question') })

    expect(response.status).toBe(403)
    expect((await read(response)).detail).toMatch(/Verify your email address/)
    expect(accounts.chats.users.get('bob')?.size ?? 0).toBe(0)
    expect(await read(await request('GET', '/api/chats', { user: 'bob-unverified' }))).toEqual({ chats: [] })
    expect((await request('DELETE', '/api/account', { user: 'bob-unverified' })).status).toBe(204)
    expect(accounts.deleted).toEqual(['bob'])
  })

  it('limits each user by the new messages they save, not by their chats', async () => {
    const { request } = setup(new RateLimiter([{ limit: 5, windowMs: 60 * 60_000 }]))
    const long = (messages: number): SavedChat => ({
      ...chat('Question'),
      messages: Array.from({ length: messages }, (_, id) => ({ id, role: id % 2 ? 'assistant' : 'user', content: 'Text' })),
    })

    // Saving the same chat again writes no new messages.
    for (let save = 0; save < 3; save++) {
      expect((await request('PUT', '/api/chats/chat-1', { body: long(4) })).status).toBe(200)
    }
    expect((await request('PUT', '/api/chats/chat-2', { body: chat('Second') })).status).toBe(200)
    const limited = await request('PUT', '/api/chats/chat-3', { body: chat('Third') })
    expect((await request('PUT', '/api/chats/chat-1', { user: 'carol', body: chat('Carol') })).status).toBe(200)

    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('3600')
    expect((await read(limited)).detail).toMatch(/Too many messages saved/)
  })

  it('rejects chat ids that are not plain identifiers', async () => {
    const { request } = setup()

    expect((await request('PUT', `/api/chats/${'x'.repeat(65)}`, { body: chat('Question') })).status).toBe(404)
    expect((await request('GET', '/api/chats/a.b')).status).toBe(404)
  })

  it('reports storage failures without details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { request, accounts } = setup()
    accounts.chats.failure = new Error('private-secret')

    const response = await request('GET', '/api/chats')

    expect(response.status).toBe(500)
    expect(await read(response)).toEqual({ detail: 'Your saved chats could not be reached. Please try again.' })
  })
})

function feedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    question: 'Arsenicum keynotes?',
    answer: 'Restlessness and anxiety [1].',
    rating: 'up',
    sources: [
      { id: 'v1/boericke_mm/1', cited: true, rating: 'up' },
      { id: 'v1/boericke_mm/2', cited: false, rating: null },
    ],
    ...overrides,
  }
}

describe('feedback', () => {
  it('saves a rating, and rating the answer again replaces it', async () => {
    const { request, accounts } = setup()

    expect((await request('PUT', '/api/feedback/chat-1-1', { body: feedback() })).status).toBe(204)
    expect((await request('PUT', '/api/feedback/chat-1-1', { body: feedback({ rating: 'down' }) })).status).toBe(204)
    await request('PUT', '/api/feedback/chat-1-1', { user: 'bob', body: feedback({ rating: null }) })

    expect(accounts.feedback.saved.get('alice/chat-1-1')).toEqual(feedback({ rating: 'down' }))
    expect(accounts.feedback.saved.get('bob/chat-1-1')?.rating).toBeNull()
  })

  it('needs a sign-in with a verified email', async () => {
    const { request, accounts } = setup()

    expect((await request('PUT', '/api/feedback/chat-1-1', { user: null, body: feedback() })).status).toBe(401)
    const unverified = await request('PUT', '/api/feedback/chat-1-1', { user: 'bob-unverified', body: feedback() })
    expect(unverified.status).toBe(403)
    expect((await read(unverified)).detail).toMatch(/Verify your email address/)
    expect(accounts.feedback.saved.size).toBe(0)
  })

  it('rejects malformed feedback and ids', async () => {
    const { request, accounts } = setup()

    for (const body of [
      { ...feedback(), rating: 'meh' },
      { ...feedback(), question: '' },
      { ...feedback(), extra: true },
      { ...feedback(), sources: [{ id: 'v1/boericke_mm/1', rating: 'up' }] },
    ]) {
      expect((await request('PUT', '/api/feedback/chat-1-1', { body })).status).toBe(422)
    }
    expect((await request('PUT', '/api/feedback/a.b', { body: feedback() })).status).toBe(404)
    expect(accounts.feedback.saved.size).toBe(0)
  })

  it('returns a chat’s ratings by message, with sources by number', async () => {
    const { request } = setup()
    await request('PUT', '/api/feedback/chat-1-1', { body: feedback() })
    await request('PUT', '/api/feedback/chat-1-3', {
      body: feedback({ rating: null, sources: [{ id: 'a', cited: true, rating: null }, { id: 'b', cited: false, rating: 'down' }] }),
    })
    // Another chat whose id begins with this one's, and another user's rating.
    await request('PUT', '/api/feedback/chat-1-2-1', { body: feedback() })
    await request('PUT', '/api/feedback/chat-1-5', { user: 'bob', body: feedback() })

    const response = await request('GET', '/api/chats/chat-1/feedback')

    expect(await read(response)).toEqual({
      ratings: { 1: { answer: 'up', sources: { 1: 'up' } }, 3: { answer: null, sources: { 2: 'down' } } },
    })
    expect(await read(await request('GET', '/api/chats/chat-9/feedback'))).toEqual({ ratings: {} })
    expect((await request('GET', '/api/chats/chat-1/feedback', { user: null })).status).toBe(401)
  })

  it('limits how many ratings each user sends', async () => {
    const { request } = setup(null, new RateLimiter([{ limit: 2, windowMs: 60_000 }]))

    await request('PUT', '/api/feedback/chat-1-1', { body: feedback() })
    await request('PUT', '/api/feedback/chat-1-1', { body: feedback() })
    const limited = await request('PUT', '/api/feedback/chat-1-1', { body: feedback() })

    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect((await request('PUT', '/api/feedback/chat-1-1', { user: 'carol', body: feedback() })).status).toBe(204)
  })
})

describe('account deletion', () => {
  it('deletes the chats and then the sign-in', async () => {
    const { request, accounts } = setup()
    await request('PUT', '/api/chats/chat-1', { body: chat('Question') })
    await request('PUT', '/api/chats/chat-1', { user: 'bob', body: chat('Question') })

    expect((await request('DELETE', '/api/account')).status).toBe(204)

    expect(accounts.chats.users.has('alice')).toBe(false)
    expect(accounts.chats.users.has('bob')).toBe(true)
    expect(accounts.deleted).toEqual(['alice'])
  })

  it('keeps the sign-in when the chats could not be deleted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { request, accounts } = setup()
    accounts.chats.failure = new Error('down')

    expect((await request('DELETE', '/api/account')).status).toBe(500)
    expect(accounts.deleted).toEqual([])
  })
})
