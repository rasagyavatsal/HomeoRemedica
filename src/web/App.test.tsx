import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import { answerStream, citation, json, pending } from './test/fakes.ts'

type Route = (init: RequestInit | undefined) => Response | Promise<Response>

/** Answer requests by path; `/api/chat` takes one handler per question, in order. */
function serve({ chat = [] as Route[] } = {}) {
  const asked: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    if (path === '/api/books') return json({ books: [{ bookId: 'boericke_mm', title: 'Boericke, Materia Medica', author: null }] })
    if (path === '/api/config') return json({ auth: null })
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
})

describe('asking', () => {
  it('streams an answer and opens the source a citation points to', async () => {
    const sources = [citation(1), citation(2, { remedyName: 'Pulsatilla', text: 'Weeping, mild, changeable.' })]
    serve({ chat: [() => answerStream('Pulsatilla is mild and weepy [2].', sources)] })
    render(<App />)

    expect(await screen.findByText('Boericke, Materia Medica')).toBeInTheDocument()
    await ask('What is Pulsatilla like?')

    expect(screen.getByRole('heading', { name: 'What is Pulsatilla like?' })).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Source 2' }))

    const panel = screen.getByRole('region', { name: 'Sources' })
    expect(within(panel).getByText('1 cited of 2 retrieved')).toBeInTheDocument()
    expect(within(panel).getByRole('article', { name: 'Source 2: Pulsatilla' })).toHaveAttribute('data-active')
    expect(within(panel).getByText('Retrieved but not cited')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Sources' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2 sources · 1 cited/ })).toBeInTheDocument()
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

  it('suggests questions in an empty chat', async () => {
    const asked = serve({ chat: [() => answerStream('Keynotes.', [citation(1)])] })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'What are the keynotes of Pulsatilla?' }))

    expect(await screen.findByText('Keynotes.')).toBeInTheDocument()
    expect(asked).toEqual([{ message: 'What are the keynotes of Pulsatilla?', history: [] }])
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
