import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import type { SavedChat } from '../server/contracts.ts'
import App from './App.tsx'
import type { Account, AuthClient } from './auth.ts'
import { LocalLibrary } from './library.ts'
import { answerStream, citation, json } from './test/fakes.ts'

const ALICE: Account = { uid: 'alice', email: 'alice@example.com', name: null }

/** A fake Firebase client whose sign-in succeeds unless `failWith` is set. */
const fake = vi.hoisted(() => {
  const state = {
    account: null as Account | null,
    listeners: new Set<(account: Account | null) => void>(),
    failWith: null as { code: string } | null,
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
      fake.set({ uid: 'alice', email: 'alice@example.com', name: null })
    }
    return {
      subscribe(listener) {
        fake.listeners.add(listener)
        listener(fake.account)
        return () => fake.listeners.delete(listener)
      },
      token: async () => `token-${fake.account?.uid}`,
      signIn,
      signUp: signIn,
      signInWithGoogle: signIn,
      resetPassword: async () => {},
      signOut: async () => fake.set(null),
    }
  },
}))

/** The API with accounts, keeping each user's chats in memory. */
function serve(chat: (() => Response)[] = []) {
  const store = new Map<string, Map<string, SavedChat>>()
  const requests: string[] = []
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
    const id = path.match(/^\/api\/chats\/(.+)$/)?.[1]

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
  return { store, requests }
}

function sidebar() {
  return screen.getByRole('navigation', { name: 'Chats' })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fake.account = null
  fake.listeners.clear()
  fake.failWith = null
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
  await userEvent.click(screen.getByRole('button', { name: 'Sign in to sync chats' }))
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

it('signs out to a fresh chat on this device', async () => {
  fake.account = ALICE
  serve([() => answerStream('Private answer.', [citation(1)])])
  render(<App />)
  await screen.findByText('alice@example.com')
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), 'Private?{Enter}')
  await screen.findByText('Private answer.')

  await userEvent.click(screen.getByRole('button', { name: 'alice@example.com' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

  expect(await screen.findByRole('button', { name: 'Sign in to sync chats' })).toBeInTheDocument()
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
  expect(screen.getByRole('button', { name: 'Sign in to sync chats' })).toBeInTheDocument()
})

it('closes the account menu on Escape or a click outside it', async () => {
  fake.account = ALICE
  serve()
  render(<App />)
  const account = await screen.findByRole('button', { name: 'alice@example.com' })

  await userEvent.click(account)
  expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus()
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

  await userEvent.click(await screen.findByRole('button', { name: 'Sign in to sync chats' }))
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
  expect(screen.queryByRole('button', { name: 'Sign in to sync chats' })).not.toBeInTheDocument()
})
