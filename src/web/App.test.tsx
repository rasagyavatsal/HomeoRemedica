import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App.tsx'
import { NOTICE_KEY } from './PractitionerNotice.tsx'
import { answerStream, citation, json, pending } from './test/fakes.ts'

type Route = (init: RequestInit | undefined) => Response | Promise<Response>

/**
 * Answer requests by path; `/api/chat` takes one handler per question, in order. With `symptoms`
 * the server sorts a question as a case when there are any and reads them from it, unless `kind`
 * or `read` answer in its place. Without `symptoms` the server cannot sort questions at all, and
 * without `diseases` it cannot read a case's.
 */
function serve({
  chat = [] as Route[],
  symptoms,
  diseases,
  kind,
  read,
}: { chat?: Route[]; symptoms?: string[]; diseases?: string[]; kind?: Route; read?: Route } = {}) {
  const asked: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    if (path === '/api/books') return json({ books: [{ bookId: 'boericke_mm', title: 'Boericke, Materia Medica', author: null }] })
    if (path === '/api/config') return json({ auth: null })
    if (path === '/api/kind' && kind) return kind(init)
    if (path === '/api/kind' && symptoms) return json({ kind: symptoms.length ? 'case' : 'question' })
    if (path === '/api/symptoms' && read) return read(init)
    if (path === '/api/symptoms' && symptoms) return json({ symptoms })
    if (path === '/api/diseases' && diseases) return json({ diseases })
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

describe('reviewing symptoms', () => {
  const symptoms = ['Mind: weeping', 'Stomach: thirstless']

  it('answers by the symptoms as the user corrected them', async () => {
    const asked = serve({ symptoms, chat: [() => answerStream('Pulsatilla covers both [1].', [citation(1)])] })
    render(<App />)

    await ask('A weepy, thirstless woman.')

    const first = await screen.findByRole('textbox', { name: 'Symptom 1' })
    expect(first).toHaveValue('Mind: weeping')
    expect(asked).toEqual([])
    await userEvent.clear(first)
    await userEvent.type(first, 'Mind: weeping, consolation ameliorates')
    await userEvent.click(screen.getByRole('button', { name: 'Remove symptom 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add symptom' }))
    expect(screen.getByRole('textbox', { name: 'Symptom 2' })).toHaveFocus()
    await userEvent.keyboard('Generalities: warm room aggravates')
    await userEvent.click(screen.getByRole('button', { name: 'Add symptom' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText(/Pulsatilla covers both/)
    expect(asked).toEqual([
      {
        message: 'A weepy, thirstless woman.',
        history: [],
        symptoms: ['Mind: weeping, consolation ameliorates', 'Generalities: warm room aggravates'],
      },
    ])
    expect(screen.queryByRole('textbox', { name: 'Symptom 1' })).not.toBeInTheDocument()
  })

  it('answers at once, without reading symptoms, when the question describes no patient', async () => {
    const asked = serve({ symptoms: [], read: () => Promise.reject(new Error('not a case')), chat: [() => answerStream('Sulphur is a polychrest [1].', [citation(1)])] })
    render(<App />)

    await ask('What is Sulphur?')

    await screen.findByText(/Sulphur is a polychrest/)
    expect(asked).toEqual([{ message: 'What is Sulphur?', history: [], symptoms: [] }])
  })

  it('asks a failed case again by the symptoms the user confirmed', async () => {
    const asked = serve({
      symptoms,
      diseases: ['asthma'],
      read: vi.fn(() => json({ symptoms })),
      chat: [() => json({ detail: 'Too many questions in a short time.' }, 429), () => answerStream('Pulsatilla [1].', [citation(1)])],
    })
    render(<App />)

    await ask('A weepy, thirstless woman.')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove symptom 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    await screen.findByText(/Pulsatilla/)
    const confirmed = { message: 'A weepy, thirstless woman.', history: [], symptoms: ['Mind: weeping'], diseases: ['asthma'] }
    expect(asked).toEqual([confirmed, confirmed])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'A weepy, thirstless woman.' })).toHaveLength(1)
  })

  it('answers by the diseases as the user corrected them', async () => {
    const asked = serve({ symptoms, diseases: ['asthma', 'eczema'], chat: [() => answerStream('Pulsatilla [1].', [citation(1)])] })
    render(<App />)

    await ask('A weepy, thirstless woman.')

    expect(await screen.findByRole('textbox', { name: 'Disease 1' })).toHaveValue('asthma')
    expect(screen.getByRole('textbox', { name: 'Symptom 1' })).toHaveValue('Mind: weeping')
    await userEvent.click(screen.getByRole('button', { name: 'Remove disease 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add disease' }))
    expect(screen.getByRole('textbox', { name: 'Disease 2' })).toHaveFocus()
    await userEvent.keyboard('sciatica')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText(/Pulsatilla/)
    expect(asked).toEqual([{ message: 'A weepy, thirstless woman.', history: [], symptoms, diseases: ['asthma', 'sciatica'] }])
  })

  it('reviews a case that names a disease but gives no symptoms, and one that names none', async () => {
    const asked = serve({
      kind: () => json({ kind: 'case' }),
      symptoms: [],
      diseases: ['asthma'],
      chat: [() => answerStream('Arsenicum [1].', [citation(1)])],
    })
    render(<App />)

    await ask('He has asthma.')
    await screen.findByRole('textbox', { name: 'Disease 1' })
    expect(screen.queryByRole('textbox', { name: 'Symptom 1' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove disease 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText(/Arsenicum/)
    expect(asked).toEqual([{ message: 'He has asthma.', history: [], symptoms: [], diseases: [] }])
  })

  it('reviews the symptoms alone when the diseases cannot be read', async () => {
    const asked = serve({ symptoms, chat: [() => answerStream('Pulsatilla [1].', [citation(1)])] })
    render(<App />)

    await ask('A weepy, thirstless woman.')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    await screen.findByText(/Pulsatilla/)
    expect(screen.queryByRole('button', { name: 'Add disease' })).not.toBeInTheDocument()
    expect(asked).toEqual([{ message: 'A weepy, thirstless woman.', history: [], symptoms }])
  })

  it('says what it is reading before the books are searched', async () => {
    let sort!: (response: Response) => void
    let found!: (response: Response) => void
    serve({
      kind: () => new Promise((resolve) => (sort = resolve)),
      read: () => new Promise((resolve) => (found = resolve)),
      chat: [(init) => pending(init?.signal)],
    })
    render(<App />)

    await ask('A weepy, thirstless woman.')
    expect(screen.getByRole('status')).toHaveTextContent('Reading your question…')
    sort(json({ kind: 'case' }))
    expect(await screen.findByText('Reading the case for symptoms and diseases…')).toBeInTheDocument()
    found(json({ symptoms }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('status')).toHaveTextContent('Searching the books…')
  })

  it('answers a case no symptoms were read from without a review', async () => {
    const asked = serve({ kind: () => json({ kind: 'case' }), symptoms: [], chat: [() => answerStream('Nothing stands out [1].', [citation(1)])] })
    render(<App />)

    await ask('She is unwell.')

    await screen.findByText(/Nothing stands out/)
    expect(asked).toEqual([{ message: 'She is unwell.', history: [], symptoms: [] }])
  })

  it('can be stopped, leaving the next question free to be asked', async () => {
    const asked = serve({ symptoms, chat: [] })
    render(<App />)

    await ask('A weepy, thirstless woman.')
    await screen.findByRole('textbox', { name: 'Symptom 1' })
    await userEvent.click(screen.getByRole('button', { name: 'Stop answering' }))

    expect(screen.getByText('Stopped.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Symptom 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send question' })).toBeInTheDocument()
    expect(asked).toEqual([])
  })
})

describe('asking', () => {
  it('streams an answer and opens the source a citation points to', async () => {
    const sources = [citation(1), citation(2, { remedyName: 'Pulsatilla', text: 'Weeping, mild, changeable.' })]
    serve({ chat: [() => answerStream('Pulsatilla is mild and weepy [2].', sources)] })
    render(<App />)

    await ask('What is Pulsatilla like?')

    expect(screen.getByRole('heading', { name: 'What is Pulsatilla like?' })).toBeInTheDocument()
    // Only the cited source is counted.
    const references = await screen.findByRole('button', { name: '1 reference' })
    expect(screen.queryByRole('region', { name: 'Pulsatilla' })).not.toBeInTheDocument()
    // Citations become buttons once the Markdown renderer has loaded.
    await userEvent.click(await screen.findByRole('button', { name: 'Source 2' }))

    // Only the clicked passage is shown.
    const panel = screen.getByRole('region', { name: 'Pulsatilla' })
    expect(within(panel).getByText('Weeping, mild, changeable.')).toBeInTheDocument()
    expect(within(panel).queryByText(sources[0].text)).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Pulsatilla' })).not.toBeInTheDocument()

    // The row lists the references, and one opens its passage, with a way back to the list.
    await userEvent.click(references)
    expect(references).toHaveAttribute('aria-pressed', 'true')
    const list = within(screen.getByRole('region', { name: 'References' })).getByRole('list', { name: 'References' })
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    await userEvent.click(within(list).getByRole('button', { name: /Pulsatilla/ }))
    expect(screen.getByRole('region', { name: 'Pulsatilla' })).toBeInTheDocument()
    // Focus follows each switch, back to the reference it left.
    expect(screen.getByRole('button', { name: 'All references' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'All references' }))
    expect(screen.getByRole('region', { name: 'References' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'References' })).getByRole('button', { name: /Pulsatilla/ })).toHaveFocus()

    // The row closes the list again.
    await userEvent.click(references)
    expect(screen.queryByRole('region', { name: 'References' })).not.toBeInTheDocument()
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

    expect(screen.getByRole('heading', { level: 1, name: 'AI for homeopathy' })).toBeInTheDocument()
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
    expect(await screen.findByText('Searching the books…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop answering' }))

    expect(screen.getByText('Stopped.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled())
  })
})

describe('compacting', () => {
  it('sends the summary the server condensed a chat into with the next question', async () => {
    const kept = [
      { role: 'user' as const, content: 'Second?' },
      { role: 'assistant' as const, content: 'Second answer.' },
    ]
    const summary = 'The user first asked about Nux vomica.'
    const asked = serve({
      chat: [
        () => answerStream('Second answer.', [citation(1)], 'Second?', kept, summary),
        () => answerStream('Third answer.', [citation(1)], 'Third?'),
      ],
    })
    render(<App />)

    await ask('Second?')
    await screen.findByText('Second answer.')
    await ask('Third?')

    await screen.findByText('Third answer.')
    expect(asked[1]).toEqual({ message: 'Third?', history: kept, summary })
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
    expect(screen.getByRole('heading', { level: 1, name: 'AI for homeopathy' })).toBeInTheDocument()
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Pulsatilla keynotes?' }))
    expect(await screen.findByRole('heading', { name: 'Pulsatilla keynotes?' })).toBeInTheDocument()

    // The logo starts a new chat too.
    await userEvent.click(within(sidebar).getByRole('button', { name: 'HomeoRemedica' }))
    expect(screen.getByRole('heading', { level: 1, name: 'AI for homeopathy' })).toBeInTheDocument()
  })

  it('deletes a chat after confirmation', async () => {
    serve({ chat: [() => answerStream('Answer.', [citation(1)])] })
    render(<App />)
    await ask('Delete me?')
    await screen.findByText('Answer.')

    await userEvent.click(screen.getByRole('button', { name: 'Delete “Delete me?”' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Your chats will appear here.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'AI for homeopathy' })).toBeInTheDocument()
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
