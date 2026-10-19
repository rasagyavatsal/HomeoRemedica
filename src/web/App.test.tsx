import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { version } from '../../package.json'
import App from './App'
import type { ChatResponse, Turn } from './api'

const books = Array.from({ length: 4 }, (_, index) => ({
  bookId: `book-${index + 1}`,
  title: `Book ${index + 1}`,
  author: `Author ${index + 1}`,
}))

const catalog = { books, corpusVersion: 'release-1', model: 'test-model' }
const firstHistory: Turn[] = [
  { role: 'user', content: 'First question' },
  { role: 'assistant', content: 'First answer' },
]

function chatResponse(answer = 'First answer', history = firstHistory): ChatResponse {
  return {
    answer,
    history,
    model: catalog.model,
    corpusVersion: catalog.corpusVersion,
    sources: [{
      id: 'release-1/book-1/chunk-1', bookId: 'book-1', bookTitle: 'Book 1',
      author: 'Author 1', remedyName: 'Remedy', sectionTitle: 'Section',
      passageIndexes: [1], text: 'The original source passage.',
    }],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url) => {
    if (url === '/api/books') return jsonResponse(catalog)
    return jsonResponse(chatResponse())
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

async function ready() {
  render(<App />)
  await screen.findByRole('list', { name: 'Books in the corpus' })
  return userEvent.setup()
}

function chatCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/chat')
}

function chatBody(index: number) {
  return JSON.parse(String(chatCalls()[index][1]?.body)) as { message: string; history: Turn[] }
}

describe('production chat interactions', () => {
  it('uses server-trimmed history for later questions', async () => {
    const user = await ready()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'First question{Enter}')
    await screen.findByText('First answer')
    expect(chatBody(0)).toEqual({ message: 'First question', history: [] })

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Second question{Enter}')
    await waitFor(() => expect(chatCalls()).toHaveLength(2))
    expect(chatBody(1)).toEqual({ message: 'Second question', history: firstHistory })

    await user.click(screen.getAllByText('Sources')[0])
    await user.click(screen.getAllByText('Book 1')[0])
    expect(screen.getAllByText('The original source passage.')[0]).toBeVisible()
  })

  it('retains a failed draft and history, and allows retry without duplicate turns', async () => {
    const user = await ready()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'First question{Enter}')
    await screen.findByText('First answer')
    fetchMock.mockImplementationOnce(async () => jsonResponse({ detail: 'The request took too long. Please try again.' }, 504))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Retry question{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('The request took too long.')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Retry question')
    expect(screen.getAllByText('First answer')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(chatCalls()).toHaveLength(3))
    expect(chatBody(2)).toEqual(chatBody(1))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''))
    expect(screen.getAllByText('Retry question')).toHaveLength(1)
  })

  it('handles CLI commands locally and clears request history', async () => {
    const user = await ready()
    const input = screen.getByRole('textbox', { name: 'Message' })
    await user.type(input, 'First question{Enter}')
    await screen.findByText('First answer')
    await user.type(input, '/clear{Enter}')
    expect(screen.queryByText('First answer')).not.toBeInTheDocument()
    await user.type(input, '/books{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Unknown command. Use /clear or /quit.')
    await user.clear(input)
    await user.type(input, '/exit{Enter}')
    expect(screen.getByText('Session ended.')).toBeVisible()
    expect(chatCalls()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Start new chat' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'New question{Enter}')
    await waitFor(() => expect(chatCalls()).toHaveLength(2))
    expect(chatBody(1).history).toEqual([])
  })

  it('supports multiline drafts, blocks duplicate requests, and preserves the draft during progress', async () => {
    const user = await ready()
    let resolveRequest: ((response: Response) => void) | undefined
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve }))
    const input = screen.getByRole('textbox', { name: 'Message' })
    await user.type(input, 'First line{Shift>}{Enter}{/Shift}Second line')
    expect(chatCalls()).toHaveLength(0)
    expect(input).toHaveValue('First line\nSecond line')
    await user.keyboard('{Enter}')
    expect(screen.getByText('Preparing an answer…')).toBeVisible()
    expect(input).toBeDisabled()
    expect(input).toHaveValue('First line\nSecond line')
    fireEvent.submit(input.closest('form')!)
    expect(chatCalls()).toHaveLength(1)
    expect(chatBody(0).message).toBe('First line\nSecond line')
    await act(async () => resolveRequest?.(jsonResponse(chatResponse())))
    expect(input).toBeEnabled()
    expect(input).toHaveValue('')
  })

  it('shows validation errors and renders Markdown without inserting HTML', async () => {
    const user = await ready()
    fetchMock.mockImplementationOnce(async () => jsonResponse({ detail: [{ msg: 'Message is too long.' }] }, 422))
    const input = screen.getByRole('textbox', { name: 'Message' })
    await user.type(input, 'Question{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Message is too long.')
    fetchMock.mockImplementationOnce(async () => jsonResponse(chatResponse('**Answer** <script>alert(1)</script>')))
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Answer')).toHaveProperty('tagName', 'STRONG')
    expect(document.querySelector('.answer script')).toBeNull()
  })

  it('links numbered citations to their sources and leaves unknown numbers as text', async () => {
    const user = await ready()
    fetchMock.mockImplementationOnce(async () => jsonResponse(chatResponse('Supported claim [1]. Unsupported claim [9].')))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Question{Enter}')
    const citation = await screen.findByRole('button', { name: 'Source 1: Remedy, Book 1' })
    expect(screen.getByText('Unsupported claim [9].', { exact: false })).toBeVisible()
    expect(screen.getByText('The original source passage.')).not.toBeVisible()
    await user.click(citation)
    expect(screen.getByText('The original source passage.')).toBeVisible()
  })

  it('asks a suggested question from the empty state', async () => {
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'What are the keynote symptoms of Arsenicum album?' }))
    await screen.findByText('First answer')
    expect(chatBody(0)).toEqual({ message: 'What are the keynote symptoms of Arsenicum album?', history: [] })
  })

  it('shows the app version', async () => {
    await ready()
    expect(screen.getByText(`v${version}`)).toBeVisible()
  })

  it('keeps the empty state usable when the book catalog fails', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ detail: 'Corpus unavailable.' }, 503))
    render(<App />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/books', expect.anything()))
    expect(screen.getByText(/drawn from historical texts/)).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Books in the corpus' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
