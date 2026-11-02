import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountClient, User } from './account'
import App from './App'
import type { ChatResponse } from './api'
import type { Conversation, StoredChat } from './chats'
import { saveChat } from './chats'

vi.mock('./account', async (importOriginal) => ({
  ...await importOriginal<typeof import('./account')>(),
  loadAccountClient: vi.fn(async () => client),
}))

const auth = { apiKey: 'public-key', authDomain: 'test.firebaseapp.com', projectId: 'test' }
const ALICE: User = { id: 'alice', email: 'alice@example.com' }

/** A Firebase stand-in whose sign-in is restored as `restored`. */
function fakeClient(restored: User | null): AccountClient & { setUser(user: User | null): void } {
  let listener: ((user: User | null) => void) | undefined
  let user = restored
  const setUser = (next: User | null) => {
    user = next
    listener?.(next)
  }
  return {
    setUser,
    onUserChanged(callback) {
      listener = callback
      queueMicrotask(() => callback(user))
      return () => { listener = undefined }
    },
    idToken: async () => `token-${user?.id}`,
    signIn: vi.fn(async (email: string, password: string) => {
      if (password !== 'correct horse') throw Object.assign(new Error('Firebase'), { code: 'auth/invalid-credential' })
      setUser({ id: 'alice', email })
    }),
    signUp: vi.fn(async (email: string) => setUser({ id: 'new', email })),
    signInWithGoogle: vi.fn(async () => setUser(ALICE)),
    resetPassword: vi.fn(async () => {}),
    signOut: vi.fn(async () => setUser(null)),
  }
}

let client: ReturnType<typeof fakeClient>
/** The account's chats on the fake server. */
let saved: Map<string, Omit<StoredChat, 'id'>>
const fetchMock = vi.fn<typeof fetch>()

function chatResponse(answer: string, question: string): ChatResponse {
  return {
    answer, model: 'test-model', corpusVersion: 'release-1', sources: [],
    history: [{ role: 'user', content: question }, { role: 'assistant', content: answer }],
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The API for one signed-in user, `token-alice`. */
async function server(url: string, init: RequestInit = {}): Promise<Response> {
  if (url === '/api/books') return json({ books: [] })
  if (url === '/api/config') return json({ auth })
  if (url === '/api/chat') {
    const { message } = JSON.parse(String(init.body)) as { message: string }
    return json(chatResponse(`Answer to ${message}`, message))
  }
  if (new Headers(init.headers).get('Authorization') !== 'Bearer token-alice') return json({ detail: 'Please sign in again.' }, 401)
  const method = init.method ?? 'GET'
  if (url === '/api/chats') {
    if (method === 'DELETE') {
      saved.clear()
      return new Response(null, { status: 204 })
    }
    const chats = [...saved].map(([id, { title, updatedAt }]) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt)
    return json({ chats })
  }
  if (url === '/api/account') {
    saved.clear()
    return new Response(null, { status: 204 })
  }
  const id = decodeURIComponent(url.replace('/api/chats/', ''))
  if (method === 'PUT') {
    saved.set(id, JSON.parse(String(init.body)))
    return json({ id })
  }
  if (method === 'DELETE') {
    saved.delete(id)
    return new Response(null, { status: 204 })
  }
  const chat = saved.get(id)
  return chat ? json({ messages: chat.messages, history: chat.history } satisfies Conversation) : json({ detail: 'Chat not found.' }, 404)
}

function savedChat(question: string, updatedAt: number): Omit<StoredChat, 'id'> {
  const answer = `Answer to ${question}`
  return {
    title: question,
    updatedAt,
    messages: [{ id: 0, role: 'user', content: question }, { id: 1, role: 'assistant', content: answer, sources: [] }],
    history: [{ role: 'user', content: question }, { role: 'assistant', content: answer }],
  }
}

function pastChats() {
  return [...document.querySelectorAll<HTMLButtonElement>('.chat-link')].map((chat) => chat.textContent)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  saved = new Map()
  client = fakeClient(null)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url, init) => server(String(url), init))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('signing in', () => {
  it('offers sign-in only when the server has accounts', async () => {
    fetchMock.mockImplementation(async (url, init) => url === '/api/config' ? json({ auth: null }) : server(String(url), init))
    render(<App />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/config', expect.anything()))
    expect(screen.getByText('Chats are saved on this device only.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('moves the chats on this device into the account', async () => {
    saved.set('account-chat', savedChat('Asked on a phone', 1))
    saveChat({ id: 'device-chat', ...savedChat('Asked on this device', 2) })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await within(screen.getByRole('banner')).findByRole('button', { name: 'Sign in' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    await user.type(within(dialog).getByLabelText('Email'), 'alice@example.com')
    await user.type(within(dialog).getByLabelText('Password'), 'correct horse{Enter}')

    await waitFor(() => expect(pastChats()).toEqual(['Asked on this device', 'Asked on a phone']))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeVisible()
    expect(screen.getByText('Chats are saved to your account.')).toBeVisible()
    expect(saved.get('device-chat')?.title).toBe('Asked on this device')
    expect(localStorage.getItem('homeoremedica:chats')).toContain('"chats":[]')
  })

  it('explains a failed sign-in and switches to sign-up and password reset', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await within(screen.getByRole('banner')).findByRole('button', { name: 'Sign in' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    await user.type(within(dialog).getByLabelText('Email'), 'alice@example.com')
    await user.type(within(dialog).getByLabelText('Password'), 'wrong{Enter}')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The email or password is incorrect.')

    await user.click(within(dialog).getByRole('button', { name: 'Forgot password?' }))
    expect(within(dialog).queryByLabelText('Password')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Send reset link' }))
    expect(client.resetPassword).toHaveBeenCalledWith('alice@example.com')
    expect(within(dialog).getByRole('status')).toHaveTextContent('a link to reset its password is on its way')

    await user.click(within(dialog).getByRole('button', { name: 'Back to sign in' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create an account' }))
    expect(within(dialog).getByRole('heading', { name: 'Create an account' })).toBeVisible()
    await user.type(within(dialog).getByLabelText('Password'), 'new password{Enter}')
    expect(client.signUp).toHaveBeenCalledWith('alice@example.com', 'new password')
  })
})

describe('signed in', () => {
  beforeEach(() => {
    client = fakeClient(ALICE)
  })

  it('saves each answer to the account', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('alice@example.com')

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Arsenicum keynotes{Enter}')
    await screen.findByText('Answer to Arsenicum keynotes')

    await waitFor(() => expect(pastChats()).toEqual(['Arsenicum keynotes']))
    const [chat] = [...saved.values()]
    expect(chat?.messages.map((message) => message.content)).toEqual(['Arsenicum keynotes', 'Answer to Arsenicum keynotes'])
    expect(localStorage.getItem('homeoremedica:chats')).toBeNull()
  })

  it('reopens an account chat after a reload', async () => {
    saved.set('chat-1', savedChat('Bryonia keynotes', 1))
    sessionStorage.setItem('homeoremedica:open-chat', JSON.stringify('chat-1'))
    render(<App />)

    expect(await screen.findByText('Answer to Bryonia keynotes')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Bryonia keynotes' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens and deletes account chats', async () => {
    saved.set('chat-1', savedChat('Bryonia keynotes', 1))
    saved.set('chat-2', savedChat('Pulsatilla temperament', 2))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Bryonia keynotes' }))
    expect(await screen.findByText('Answer to Bryonia keynotes')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete chat: Bryonia keynotes' }))
    await waitFor(() => expect(pastChats()).toEqual(['Pulsatilla temperament']))
    expect(saved.has('chat-1')).toBe(false)
    expect(screen.queryByText('Answer to Bryonia keynotes')).not.toBeInTheDocument()
  })

  it('clears the open chat when signing out', async () => {
    saved.set('chat-1', savedChat('Bryonia keynotes', 1))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Bryonia keynotes' }))
    await screen.findByText('Answer to Bryonia keynotes')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(screen.queryByText('Answer to Bryonia keynotes')).not.toBeInTheDocument())
    expect(pastChats()).toEqual([])
    expect(screen.getByText(/Chats are saved on this device only/)).toBeVisible()
  })

  it('asks before deleting the account', async () => {
    saved.set('chat-1', savedChat('Bryonia keynotes', 1))
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'Bryonia keynotes' })

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const confirm = screen.getByRole('group', { name: 'Delete your account and its chats?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(saved.size).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await user.click(within(screen.getByRole('group', { name: 'Delete your account and its chats?' })).getByRole('button', { name: 'Delete account' }))

    await waitFor(() => expect(client.signOut).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/account', expect.objectContaining({ method: 'DELETE' }))
    expect(saved.size).toBe(0)
    expect(pastChats()).toEqual([])
  })

  it('keeps an answer on screen when it could not be saved', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('alice@example.com')
    fetchMock.mockImplementation(async (url, init) => init?.method === 'PUT'
      ? json({ detail: 'Your saved chats could not be reached. Please try again.' }, 500)
      : server(String(url), init))

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Arsenicum keynotes{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('This chat could not be saved. Your saved chats could not be reached.')
    expect(screen.getByText('Answer to Arsenicum keynotes')).toBeVisible()
  })

  it('refreshes the account chats when the tab is shown again', async () => {
    render(<App />)
    await screen.findByText('alice@example.com')
    saved.set('chat-1', savedChat('Asked on a phone', 1))

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })

    await waitFor(() => expect(pastChats()).toEqual(['Asked on a phone']))
    cleanup()
  })
})
