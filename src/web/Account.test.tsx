import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import { version } from '../../package.json'
import type { AnswerRatings, Feedback, SavedChat } from '../server/contracts.ts'
import App from './App.tsx'
import type { Account, AuthClient } from './auth.ts'
import { NOTICE_KEY } from './PractitionerNotice.tsx'
import { LocalLibrary } from './library.ts'
import { answerStream, citation, json } from './test/fakes.ts'

const ALICE: Account = { uid: 'alice', email: 'alice@example.com', name: null, verified: true }

/** A fake Firebase client whose sign-in succeeds unless `failWith` is set. */
const fake = vi.hoisted(() => {
  const state = {
    account: null as Account | null,
    listeners: new Set<(account: Account | null) => void>(),
    failWith: null as { code: string } | null,
    verificationsSent: 0,
    set(account: Account | null) {
      state.account = account
      for (const listener of state.listeners) listener(account)
    },
  }
  return state
})

vi.mock('./auth.ts', async (original) => ({
  ...(await original<typeof import('./auth.ts')>()),
  connectAuth: async (): Promise<AuthClient> => {
    const signIn = async () => {
      if (fake.failWith) throw fake.failWith
      fake.set({ uid: 'alice', email: 'alice@example.com', name: null, verified: true })
    }
    return {
      subscribe(listener) {
        fake.listeners.add(listener)
        listener(fake.account)
        return () => fake.listeners.delete(listener)
      },
      token: async () => `token-${fake.account?.uid}`,
      signIn,
      signUp: async () => {
        fake.verificationsSent++
        fake.set({ uid: 'alice', email: 'alice@example.com', name: null, verified: false })
      },
      signInWithGoogle: signIn,
      sendVerification: async () => {
        fake.verificationsSent++
      },
      refresh: async () => {},
      resetPassword: async () => {},
      signOut: async () => fake.set(null),
    }
  },
}))

/** The API with accounts, keeping each user's chats in memory. */
function serve(chat: (() => Response)[] = []) {
  const store = new Map<string, Map<string, SavedChat>>()
  const feedback = new Map<string, Feedback>()
  const requests: string[] = []
  const server = { store, feedback, requests, feedbackFails: false }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    requests.push(`${method} ${path}`)
    if (path === '/api/books') return json({ books: [] })
    if (path === '/api/config') return json({ auth: { apiKey: 'key', authDomain: 'x.firebaseapp.com', projectId: 'x' } })
    if (path === '/api/chat') return chat.shift()!()

    const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer token-', '')
    if (!token || token === 'undefined') return json({ detail: 'Please sign in again.' }, 401)
    const chats = store.get(token) ?? new Map<string, SavedChat>()
    store.set(token, chats)
    const ratedChat = path.match(/^\/api\/chats\/(.+)\/feedback$/)?.[1]
    const id = ratedChat ? undefined : path.match(/^\/api\/chats\/(.+)$/)?.[1]
    const feedbackId = path.match(/^\/api\/feedback\/(.+)$/)?.[1]

    if (ratedChat) {
      const prefix = `${token}/${ratedChat}-`
      const ratings = [...feedback].filter(([key]) => key.startsWith(prefix))
      const rated = ({ rating, sources, reasons, comment }: Feedback): AnswerRatings => ({
        answer: rating,
        sources: Object.fromEntries(sources.flatMap((source, index) => (source.rating ? [[index + 1, source.rating]] : []))),
        reasons,
        comment,
      })
      return json({ ratings: Object.fromEntries(ratings.map(([key, saved]) => [key.slice(prefix.length), rated(saved)])) })
    }

    if (feedbackId && method === 'PUT') {
      if (server.feedbackFails) return json({ detail: 'Ratings are down.' }, 500)
      feedback.set(`${token}/${feedbackId}`, JSON.parse(init?.body as string) as Feedback)
      return new Response(null, { status: 204 })
    }

    if (path === '/api/chats') {
      const list = [...chats].map(([chatId, { title, updatedAt }]) => ({ id: chatId, title, updatedAt }))
      return json({ chats: list.sort((a, b) => b.updatedAt - a.updatedAt) })
    }
    if (path === '/api/account' && method === 'DELETE') {
      store.delete(token)
      return new Response(null, { status: 204 })
    }
    if (id && method === 'PUT') {
      const saved = JSON.parse(init?.body as string) as SavedChat
      chats.set(id, saved)
      return json({ id, title: saved.title, updatedAt: saved.updatedAt })
    }
    if (id && method === 'GET') {
      const saved = chats.get(id)
      return saved ? json({ messages: saved.messages, history: saved.history }) : json({ detail: 'Chat not found.' }, 404)
    }
    return json({ detail: 'Not Found' }, 404)
  })
  return server
}

function sidebar() {
  return screen.getByRole('navigation', { name: 'Chats' })
}

async function openSignIn() {
  await userEvent.click(await screen.findByRole('button', { name: 'Guest' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in to sync chats' }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // Past the practitioner notice, which has its own tests.
  localStorage.setItem(NOTICE_KEY, 'seen')
  fake.account = null
  fake.listeners.clear()
  fake.failWith = null
  fake.verificationsSent = 0
})

it('moves this device’s chats into the account at sign-in', async () => {
  await new LocalLibrary().save({
    id: 'local-1',
    title: 'Saved before signing in',
    updatedAt: 1,
    messages: [
      { id: 0, role: 'user', content: 'Saved before signing in' },
      { id: 1, role: 'assistant', content: 'Answer [1].', sources: [citation(1)] },
    ],
    history: [],
  })
  const { store } = serve()
  render(<App />)

  expect(await within(sidebar()).findByRole('button', { name: 'Saved before signing in' })).toBeInTheDocument()
  await openSignIn()
  const dialog = screen.getByRole('dialog', { name: 'Sign in' })
  await userEvent.type(within(dialog).getByLabelText('Email'), 'alice@example.com')
  await userEvent.type(within(dialog).getByLabelText('Password'), 'secret123')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByRole('button', { name: 'alice@example.com' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(await within(sidebar()).findByRole('button', { name: 'Saved before signing in' })).toBeInTheDocument()
  expect(store.get('alice')?.get('local-1')?.title).toBe('Saved before signing in')
  expect(await new LocalLibrary().list()).toEqual([])
})

it('saves answers to the account and reopens them', async () => {
  fake.account = ALICE
  const { store } = serve([() => answerStream('Synced answer [1].', [citation(1)], 'Synced?')])
  const { unmount } = render(<App />)

  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Synced?{Enter}')
  await screen.findByText(/Synced answer/)

  await waitFor(() => expect([...(store.get('alice')?.values() ?? [])]).toHaveLength(1))
  const [saved] = store.get('alice')!.values()
  expect(saved).toMatchObject({ title: 'Synced?', history: [{ role: 'user', content: 'Synced?' }, { role: 'assistant' }] })
  expect(saved!.messages.map((message) => message.content)).toEqual(['Synced?', 'Synced answer [1].'])
  expect(await new LocalLibrary().list()).toEqual([])

  unmount()
  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Synced?' })).toBeInTheDocument()
})

it('keeps chats on this device until a new account’s email is verified', async () => {
  const { store, requests } = serve([() => answerStream('Kept answer.', [citation(1)], 'Kept?')])
  render(<App />)

  await openSignIn()
  const dialog = screen.getByRole('dialog', { name: 'Sign in' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create an account' }))
  await userEvent.type(within(dialog).getByLabelText('Email'), 'alice@example.com')
  await userEvent.type(within(dialog).getByLabelText('Password'), 'secret123')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create an account' }))

  expect(await screen.findByText(/Verify your email address to sync your chats/)).toBeInTheDocument()
  expect(fake.verificationsSent).toBe(1)
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Kept?{Enter}')
  await screen.findByText('Kept answer.')
  await waitFor(async () => expect(await new LocalLibrary().list()).toHaveLength(1))
  expect(requests.filter((request) => request.includes('/api/chats'))).toEqual([])

  await userEvent.click(screen.getByRole('button', { name: 'alice@example.com' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Resend verification email' }))
  expect(await screen.findByText('A new verification link was sent to alice@example.com.')).toBeInTheDocument()
  expect(fake.verificationsSent).toBe(2)

  act(() => fake.set(ALICE))

  expect(await within(sidebar()).findByRole('button', { name: 'Kept?' })).toBeInTheDocument()
  await waitFor(() => expect([...(store.get('alice')?.values() ?? [])].map((chat) => chat.title)).toEqual(['Kept?']))
  expect(await new LocalLibrary().list()).toEqual([])
  await userEvent.click(screen.getByRole('button', { name: 'alice@example.com' }))
  expect(screen.queryByRole('menuitem', { name: 'Resend verification email' })).not.toBeInTheDocument()
})

it('rates answers and their passages', async () => {
  fake.account = ALICE
  const { feedback } = serve([() => answerStream('Rated answer [2].', [citation(1), citation(2)], 'Rated?')])
  render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Rated?{Enter}')
  await screen.findByText(/Rated answer/)

  const answer = screen.getByRole('group', { name: 'Rate this answer' })
  await userEvent.click(within(answer).getByRole('button', { name: 'Helpful' }))
  expect(within(answer).getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Source 2' }))
  const passage = screen.getByRole('group', { name: 'Rate this passage' })
  await userEvent.click(within(passage).getByRole('button', { name: 'Not relevant' }))

  await waitFor(() =>
    expect([...feedback.values()]).toEqual([
      {
        question: 'Rated?',
        answer: 'Rated answer [2].',
        rating: 'up',
        sources: [
          { id: citation(1).id, cited: false, rating: null },
          { id: citation(2).id, cited: true, rating: 'down' },
        ],
        reasons: [],
        comment: null,
      },
    ]),
  )
  const [id] = feedback.keys()
  expect(id).toMatch(/^alice\/[\w-]+-1$/)

  // Pressing the chosen thumb reopens its comment box, and pressing it again there takes the rating back.
  await userEvent.click(within(answer).getByRole('button', { name: 'Helpful' }))
  expect(screen.getByRole('textbox', { name: 'Comment' })).toBeInTheDocument()
  await userEvent.click(within(answer).getByRole('button', { name: 'Helpful' }))
  await waitFor(() => expect(feedback.get(id!)?.rating).toBeNull())
  expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument()
  expect(feedback.size).toBe(1)
})

it('shows saved ratings when a chat is opened again', async () => {
  fake.account = ALICE
  const { feedback } = serve([() => answerStream('Kept answer [1].', [citation(1)], 'Kept?')])
  const { unmount } = render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Kept?{Enter}')
  await screen.findByText(/Kept answer/)
  await userEvent.click(within(screen.getByRole('group', { name: 'Rate this answer' })).getByRole('button', { name: 'Not helpful' }))
  await userEvent.click(screen.getByRole('button', { name: 'Source 1' }))
  await userEvent.click(within(screen.getByRole('group', { name: 'Rate this passage' })).getByRole('button', { name: 'Relevant' }))
  await waitFor(() => expect([...feedback.values()][0]?.sources[0]?.rating).toBe('up'))

  unmount()
  render(<App />)
  await screen.findByRole('heading', { name: 'Kept?' })

  const answer = await screen.findByRole('group', { name: 'Rate this answer' })
  await waitFor(() => expect(within(answer).getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'true'))
  await userEvent.click(screen.getByRole('button', { name: 'Source 1' }))
  const passage = screen.getByRole('group', { name: 'Rate this passage' })
  expect(within(passage).getByRole('button', { name: 'Relevant' })).toHaveAttribute('aria-pressed', 'true')

  // A new rating keeps the loaded ones.
  await userEvent.click(within(answer).getByRole('button', { name: 'Helpful' }))
  await waitFor(() => expect([...feedback.values()][0]).toMatchObject({ rating: 'up', sources: [{ rating: 'up' }] }))
})

it('takes a comment, and reasons for an answer rated down', async () => {
  fake.account = ALICE
  const { feedback } = serve([() => answerStream('Thin answer [1].', [citation(1)], 'Thin?')])
  const { unmount } = render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Thin?{Enter}')
  await screen.findByText(/Thin answer/)
  const answer = screen.getByRole('group', { name: 'Rate this answer' })

  await userEvent.click(within(answer).getByRole('button', { name: 'Not helpful' }))
  const comment = screen.getByRole('textbox', { name: 'Comment' })
  expect(comment).toHaveFocus()
  expect(comment).toHaveAttribute('placeholder', 'What was missing or wrong?')
  await userEvent.click(screen.getByRole('button', { name: 'Irrelevant sources' }))
  await userEvent.click(screen.getByRole('button', { name: 'Unclear' }))
  await userEvent.click(screen.getByRole('button', { name: 'Unclear' }))
  await userEvent.type(comment, '  Missed the mind symptoms.{Enter}')

  expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument()
  await waitFor(() =>
    expect([...feedback.values()][0]).toMatchObject({
      rating: 'down',
      reasons: ['irrelevant_sources'],
      comment: 'Missed the mind symptoms.',
    }),
  )

  // Choosing the thumb again reopens the comment; a thumbs-up drops the reasons.
  await userEvent.click(within(answer).getByRole('button', { name: 'Not helpful' }))
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Missed the mind symptoms.')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument()
  await userEvent.click(within(answer).getByRole('button', { name: 'Helpful' }))
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveAttribute('placeholder', 'What helped?')
  expect(screen.queryByRole('button', { name: 'Irrelevant sources' })).not.toBeInTheDocument()
  await waitFor(() => expect([...feedback.values()][0]).toMatchObject({ rating: 'up', reasons: [], comment: 'Missed the mind symptoms.' }))

  // The comment is there after a reload.
  unmount()
  render(<App />)
  await screen.findByRole('heading', { name: 'Thin?' })
  const reloaded = await screen.findByRole('group', { name: 'Rate this answer' })
  await waitFor(() => expect(within(reloaded).getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'true'))
  await userEvent.click(within(reloaded).getByRole('button', { name: 'Helpful' }))
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Missed the mind symptoms.')
})

it('closes an empty comment box on a click elsewhere, and keeps one with text', async () => {
  fake.account = ALICE
  serve([() => answerStream('Answer [1].', [citation(1)], 'Question?')])
  render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Question?{Enter}')
  await screen.findByText(/Answer/)
  const helpful = within(screen.getByRole('group', { name: 'Rate this answer' })).getByRole('button', { name: 'Helpful' })

  await userEvent.click(helpful)
  await userEvent.click(screen.getByRole('textbox', { name: 'Your question' }))
  expect(screen.queryByRole('textbox', { name: 'Comment' })).not.toBeInTheDocument()

  await userEvent.click(helpful)
  await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Clear')
  await userEvent.click(screen.getByRole('textbox', { name: 'Your question' }))
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Clear')
  expect(helpful).toHaveAttribute('aria-pressed', 'true')
})

it('undoes a rating that could not be saved', async () => {
  fake.account = ALICE
  const server = serve([() => answerStream('Answer.', [citation(1)], 'Question?')])
  server.feedbackFails = true
  render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Question?{Enter}')
  await screen.findByText('Answer.')

  const helpful = within(screen.getByRole('group', { name: 'Rate this answer' })).getByRole('button', { name: 'Helpful' })
  await userEvent.click(helpful)

  expect(await screen.findByText('Your feedback could not be saved. Ratings are down.')).toBeInTheDocument()
  expect(helpful).toHaveAttribute('aria-pressed', 'false')
})

it('offers ratings only to a verified account', async () => {
  serve([() => answerStream('Guest answer [1].', [citation(1)], 'Guest?')])
  render(<App />)
  await screen.findByRole('button', { name: 'Guest' })
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Guest?{Enter}')
  await screen.findByText(/Guest answer/)
  await userEvent.click(screen.getByRole('button', { name: 'Source 1' }))

  expect(screen.queryByRole('group', { name: 'Rate this answer' })).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Rate this passage' })).not.toBeInTheDocument()
})

it('signs out to a fresh chat on this device', async () => {
  fake.account = ALICE
  serve([() => answerStream('Private answer.', [citation(1)])])
  render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Private?{Enter}')
  await screen.findByText('Private answer.')

  await userEvent.click(screen.getByRole('button', { name: 'alice@example.com' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

  expect(await screen.findByRole('button', { name: 'Guest' })).toBeInTheDocument()
  expect(screen.queryByText('Private answer.')).not.toBeInTheDocument()
  expect(await within(sidebar()).findByText('Your chats will appear here.')).toBeInTheDocument()
})

it('deletes the account after confirmation', async () => {
  fake.account = ALICE
  const { requests } = serve()
  render(<App />)
  await screen.findByText('alice@example.com')

  await userEvent.click(screen.getByRole('button', { name: 'alice@example.com' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account…' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete your account?' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }))

  expect(await screen.findByText('Your account and its chats were deleted.')).toBeInTheDocument()
  expect(requests).toContain('DELETE /api/account')
  expect(screen.getByRole('button', { name: 'Guest' })).toBeInTheDocument()
})

it('links the legal pages from the account menu', async () => {
  fake.account = ALICE
  serve()
  render(<App />)

  await userEvent.click(await screen.findByRole('button', { name: 'alice@example.com' }))
  expect(screen.getByRole('menuitem', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms')
  expect(screen.getByRole('menuitem', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
})

it('shows the version in the account menu', async () => {
  serve()
  render(<App />)

  await userEvent.click(await screen.findByRole('button', { name: 'Guest' }))
  expect(within(screen.getByRole('menu')).getByText(`v${version}`)).toBeInTheDocument()
})

it('closes the account menu on Escape or a click outside it', async () => {
  fake.account = ALICE
  serve()
  render(<App />)
  const account = await screen.findByRole('button', { name: 'alice@example.com' })

  await userEvent.click(account)
  expect(screen.getByRole('menuitem', { name: 'Terms of Use' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(account).toHaveFocus()

  await userEvent.click(account)
  await userEvent.click(screen.getByRole('textbox', { name: 'Your question' }))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('explains a failed sign-in and offers a password reset', async () => {
  fake.failWith = { code: 'auth/invalid-credential' }
  serve()
  render(<App />)

  await openSignIn()
  const dialog = screen.getByRole('dialog', { name: 'Sign in' })
  await userEvent.type(within(dialog).getByLabelText('Email'), 'alice@example.com')
  await userEvent.type(within(dialog).getByLabelText('Password'), 'wrong')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }))

  expect(await within(dialog).findByRole('alert')).toHaveTextContent('The email or password is incorrect.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Forgot password?' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Send reset link' }))
  expect(await within(dialog).findByRole('status')).toHaveTextContent('a reset link is on its way')
})

it('keeps chats on this device when the server has no accounts', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === '/api/config' ? json({ auth: null }) : json({ books: [] }),
  )
  render(<App />)

  expect(await within(sidebar()).findByText('Your chats will appear here.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Guest' }))
  expect(screen.getByRole('menuitem', { name: 'Privacy Policy' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Sign in to sync chats' })).not.toBeInTheDocument()
})
