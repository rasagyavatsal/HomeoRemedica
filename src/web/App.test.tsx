import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import { NOTICE_KEY } from './PractitionerNotice.tsx'
import { answerStream, citation, json, pending } from './test/fakes.ts'

type Route = (init: RequestInit | undefined) => Response | Promise<Response>

/** Answer requests by path; `/api/chat` takes one handler per question, in order. */
function serve({ chat = [] as Route[], compact }: { chat?: Route[]; compact?: Route } = {}) {
  const asked: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    if (path === '/api/books') return json({ books: [{ bookId: 'boericke_mm', title: 'Boericke, Materia Medica', author: null }] })
    if (path === '/api/config') return json({ auth: null })
    if (path === '/api/chat/compact' && compact) return compact(init)
    if (path === '/api/chat') {
      asked.push(JSON.parse(init?.body as string))
      const next = chat.shift()
      if (!next) throw new Error('unexpected question')
      return next(init)
    }
    return json({ detail: 'Not Found' }, 404)
  })
  return asked
}

async function ask(question: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Your question' }), `${question}{Enter}`)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // Past the practitioner notice, which has its own tests.
  localStorage.setItem(NOTICE_KEY, 'seen')
})

describe('asking', () => {
  it('streams an answer and opens the source a citation points to', async () => {
    const sources = [citation(1), citation(2, { remedyName: 'Pulsatilla', text: 'Weeping, mild, changeable.' })]
    serve({ chat: [() => answerStream('Pulsatilla is mild and weepy [2].', sources)] })
    render(<App />)

    await ask('What is Pulsatilla like?')

    expect(screen.getByRole('heading', { name: 'What is Pulsatilla like?' })).toBeInTheDocument()
    const references = await screen.findByRole('list', { name: 'References' })
    expect(within(references).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Pulsatilla' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Source 2' }))

    // Only the clicked passage is shown.
    const panel = screen.getByRole('region', { name: 'Pulsatilla' })
    expect(within(panel).getByText('Weeping, mild, changeable.')).toBeInTheDocument()
    expect(within(panel).queryByText(sources[0].text)).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Pulsatilla' })).not.toBeInTheDocument()

    await userEvent.click(within(references).getByRole('button', { name: /Pulsatilla/ }))
    expect(screen.getByRole('region', { name: 'Pulsatilla' })).toBeInTheDocument()
  })

  it('sends the history the server returned with the last answer', async () => {
    const asked = serve({
      chat: [() => answerStream('First answer.', [citation(1)], 'First?'), () => answerStream('Second answer.', [citation(1)])],
    })
    render(<App />)

    await ask('First?')
    await screen.findByText('First answer.')
    await ask('Second?')
    await screen.findByText('Second answer.')

    expect(asked).toEqual([
      { message: 'First?', history: [] },
      {
        message: 'Second?',
        history: [
          { role: 'user', content: 'First?' },
          { role: 'assistant', content: 'First answer.' },
        ],
      },
    ])
  })

  it('shows the tagline in an empty chat', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Ask the classical homoeopathic literature.' })).toBeInTheDocument()
  })

  it('shows a failure and asks again on request', async () => {
    serve({
      chat: [() => json({ detail: 'Too many questions in a short time.' }, 429), () => answerStream('Recovered.', [citation(1)])],
    })
    render(<App />)

    await ask('Hello?')
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many questions in a short time.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Recovered.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Hello?' })).toHaveLength(1)
  })

  it('stops an answer in progress', async () => {
    serve({ chat: [(init) => pending(init?.signal)] })
    render(<App />)

    await ask('Slow?')
    expect(screen.getByRole('status')).toHaveTextContent('Searching the books…')
    await userEvent.click(screen.getByRole('button', { name: 'Stop answering' }))

    expect(screen.getByText('Stopped.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled())
  })
})

describe('context', () => {
  const first = [
    { role: 'user' as const, content: 'First?' },
    { role: 'assistant' as const, content: 'First answer.' },
  ]
  const second = [
    { role: 'user' as const, content: 'Second?' },
    { role: 'assistant' as const, content: 'Second answer.' },
  ]

  it('shows how full the context is and compacts it', async () => {
    const compacted: unknown[] = []
    const asked = serve({
      chat: [
        () => answerStream('First answer.', [citation(1)], 'First?'),
        () => answerStream('Second answer.', [citation(1)], 'Second?', [...first, ...second]),
        () => answerStream('Third answer.', [citation(1)], 'Third?'),
      ],
      compact: (init) => {
        compacted.push(JSON.parse(init?.body as string))
        return json({ summary: 'The user first asked about Nux vomica.', history: second })
      },
    })
    render(<App />)

    expect(screen.queryByRole('button', { name: /^Context/ })).not.toBeInTheDocument()
    await ask('First?')
    await screen.findByText('First answer.')
    await ask('Second?')
    await screen.findByText('Second answer.')
    await userEvent.click(screen.getByRole('button', { name: 'Context 20% full' }))

    const popover = screen.getByRole('dialog', { name: 'Context' })
    expect(popover).toHaveTextContent('20% of context used')
    await userEvent.click(within(popover).getByRole('button', { name: 'Compact' }))

    expect(compacted).toEqual([{ history: [...first, ...second] }])
    const divider = await screen.findByRole('button', { name: 'Compacted' })
    // Only the latest exchange is left to condense, so there is nothing more to compact.
    expect(within(popover).getByRole('button', { name: 'Compact' })).toBeDisabled()
    await userEvent.click(divider)
    expect(screen.getByText('The user first asked about Nux vomica.')).toBeInTheDocument()

    await ask('Third?')
    await screen.findByText('Third answer.')
    expect(asked[2]).toEqual({ message: 'Third?', history: second, summary: 'The user first asked about Nux vomica.' })
  })

  it('shows a failed compaction and keeps the context', async () => {
    serve({
      chat: [() => answerStream('Second answer.', [citation(1)], 'Second?', [...first, ...second])],
      compact: () => json({ detail: 'The request took too long. Please try again.' }, 504),
    })
    render(<App />)

    await ask('Second?')
    await screen.findByText('Second answer.')
    await userEvent.click(screen.getByRole('button', { name: /^Context/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Compact' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The chat could not be compacted. The request took too long. Please try again.',
    )
    expect(screen.getByRole('dialog', { name: 'Context' })).toHaveTextContent('20% of context used')
  })
})

describe('saved chats', () => {
  it('lists an answered chat, reopens it after a reload and starts new ones', async () => {
    serve({ chat: [() => answerStream('Keynotes [1].', [citation(1)])] })
    const { unmount } = render(<App />)

    await ask('Pulsatilla keynotes?')
    await screen.findByText(/Keynotes/)
    const chats = screen.getByRole('navigation', { name: 'Chats' })
    expect(within(chats).getByRole('button', { name: 'Pulsatilla keynotes?' })).toHaveAttribute('aria-current', 'page')

    unmount()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Pulsatilla keynotes?' })).toBeInTheDocument()
    expect(screen.getByText(/Keynotes/)).toBeInTheDocument()

    const sidebar = screen.getByRole('navigation', { name: 'Chats' })
    await userEvent.click(within(sidebar).getByRole('button', { name: 'New chat' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ask the classical homoeopathic literature.' })).toBeInTheDocument()
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Pulsatilla keynotes?' }))
    expect(await screen.findByRole('heading', { name: 'Pulsatilla keynotes?' })).toBeInTheDocument()
  })

  it('deletes a chat after confirmation', async () => {
    serve({ chat: [() => answerStream('Answer.', [citation(1)])] })
    render(<App />)
    await ask('Delete me?')
    await screen.findByText('Answer.')

    await userEvent.click(screen.getByRole('button', { name: 'Delete “Delete me?”' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Your chats will appear here.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Ask the classical homoeopathic literature.' })).toBeInTheDocument()
    expect(localStorage.getItem('homeoremedica.library.v1')).toBe('[]')
  })

  it('saves a stopped answer', async () => {
    serve({ chat: [(init) => pending(init?.signal)] })
    render(<App />)

    await ask('Slow?')
    await userEvent.click(screen.getByRole('button', { name: 'Stop answering' }))

    const chats = screen.getByRole('navigation', { name: 'Chats' })
    expect(within(chats).getByRole('button', { name: 'Slow?' })).toBeInTheDocument()
  })
})
