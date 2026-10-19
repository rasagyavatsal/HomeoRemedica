import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { version } from '../../package.json'
import { loadBooks, sendMessage } from './api'
import type { Book, Source, Turn } from './api'
import { Answer } from './Answer'
import { BooksDialog, bookLabel } from './BooksDialog'
import { AlertIcon, ArrowUpIcon, BookIcon, MarkIcon, PlusIcon } from './icons'

interface Message extends Turn {
  id: number
  sources?: readonly Source[]
}

const COMMANDS = [
  { name: '/books', description: 'Choose which books to search' },
  { name: '/clear', description: 'Start a new conversation' },
  { name: '/quit', description: 'End this session' },
] as const

const SUGGESTIONS = [
  'What are the keynote symptoms of Arsenicum album?',
  'Compare Bryonia and Rhus toxicodendron for joint pain.',
  'Which remedies are worse from cold, damp weather?',
  'How is the Pulsatilla temperament described?',
]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.'
}

function EmptyState({ books, onAsk }: { books: readonly Book[]; onAsk: (question: string) => void }) {
  return (
    <div className="empty-state">
      <span className="empty-mark"><MarkIcon size={28} /></span>
      <h1>Ask the classical materia medica.</h1>
      <p className="empty-lede">
        Answers are drawn from {books.length ? `${books.length} historical texts` : 'historical texts'} and cite the passages they rely on.
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="suggestion" onClick={() => onAsk(suggestion)}>{suggestion}</button>
        ))}
      </div>
      {books.length > 0 && (
        <ul className="corpus-books" aria-label="Books in the corpus">
          {books.map((book) => <li key={book.bookId}>{book.author ?? book.title}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function App() {
  const [books, setBooks] = useState<readonly Book[]>([])
  const [booksLoading, setBooksLoading] = useState(true)
  const [booksError, setBooksError] = useState('')
  const [selectedBooks, setSelectedBooks] = useState<string[] | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState(false)
  const [status, setStatus] = useState('')
  const [booksOpen, setBooksOpen] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const latestQuestion = useRef<HTMLElement>(null)
  const progress = useRef<HTMLDivElement>(null)
  const nextId = useRef(0)
  const requestInFlight = useRef(false)

  async function refreshBooks(signal?: AbortSignal) {
    setBooksLoading(true)
    setBooksError('')
    try {
      const response = await loadBooks(signal)
      if (signal?.aborted) return
      setBooks(response.books)
    } catch (failure) {
      if (signal?.aborted) return
      setBooksError(errorMessage(failure))
    } finally {
      if (!signal?.aborted) setBooksLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void refreshBooks(controller.signal)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 200)}px`
  }, [draft, ended])

  // Bring each new exchange to the top of the view so long answers read from their start.
  useEffect(() => {
    latestQuestion.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [messages])

  useEffect(() => {
    if (pending) progress.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [pending])

  function clearConversation() {
    if (requestInFlight.current) return
    setMessages([])
    setHistory([])
    setDraft('')
    setError('')
    setEnded(false)
    setStatus('Conversation cleared.')
    window.scrollTo?.({ top: 0 })
    textarea.current?.focus()
  }

  function runCommand(command: string) {
    setError('')
    if (command === '/books') {
      setBooksOpen(true)
      setDraft('')
    } else if (command === '/clear') {
      clearConversation()
    } else if (command === '/quit' || command === '/exit') {
      setEnded(true)
      setDraft('')
    } else {
      setError('Unknown command. Use /books, /clear, or /quit.')
    }
  }

  async function submit(event?: FormEvent, text = draft) {
    event?.preventDefault()
    const message = text.trim()
    if (!message || requestInFlight.current || ended) return
    setError('')
    setStatus('')
    if (message.startsWith('/')) {
      runCommand(message)
      return
    }
    requestInFlight.current = true
    setDraft(text)
    setPending(true)
    try {
      const response = await sendMessage(message, history, selectedBooks)
      setMessages((previous) => [...previous,
        { id: nextId.current++, role: 'user', content: message },
        { id: nextId.current++, role: 'assistant', content: response.answer, sources: response.sources },
      ])
      setHistory(response.history)
      setDraft('')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      requestInFlight.current = false
      setPending(false)
      requestAnimationFrame(() => textarea.current?.focus())
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const commandMatches = /^\/\S*$/.test(draft) ? COMMANDS.filter((command) => command.name.startsWith(draft)) : []
  const lastUserId = messages.findLast((message) => message.role === 'user')?.id
  const empty = !messages.length && !pending

  return (
    <div className="app-shell">
      <header className="header">
        <a className="wordmark" href="/" aria-label="HomeoRemedica home">
          <span className="wordmark-mark"><MarkIcon /></span>
          <span>Homeo<span className="wordmark-accent">Remedica</span></span>
        </a>
        <div className="header-actions">
          <button className={`button books-button ${selectedBooks ? 'is-filtered' : ''}`} type="button" onClick={() => setBooksOpen(true)} disabled={pending} aria-haspopup="dialog">
            <BookIcon /><span>{bookLabel(selectedBooks)}</span>
          </button>
          <button className="button quiet" type="button" onClick={clearConversation} disabled={pending || (!messages.length && !draft && !ended)} aria-label="New chat" title="New chat">
            <PlusIcon /><span className="button-text">New chat</span>
          </button>
        </div>
      </header>

      <main className="main">
        <div className={`conversation ${empty ? 'conversation-empty' : ''}`} aria-label="Conversation" role="log" aria-live="polite" aria-relevant="additions">
          {empty && !ended && <EmptyState books={books} onAsk={(question) => void submit(undefined, question)} />}
          {messages.map((message) => message.role === 'user' ? (
            <article className="message message-user" key={message.id} ref={message.id === lastUserId ? latestQuestion : undefined}>
              <h2 className="sr-only">You</h2>
              <div className="user-content">{message.content}</div>
            </article>
          ) : (
            <article className="message message-assistant" key={message.id}>
              <h2 className="message-label"><span className="avatar"><MarkIcon size={14} /></span>HomeoRemedica</h2>
              <Answer id={message.id} content={message.content} sources={message.sources ?? []} />
            </article>
          ))}
          {pending && (
            <div className="message message-assistant request-progress" ref={progress} role="status">
              <span className="message-label"><span className="avatar avatar-pulse"><MarkIcon size={14} /></span>Preparing an answer…</span>
              <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>
            </div>
          )}
        </div>

        <div className="composer-area">
          <div className="composer-stack">
            {error && <p className="error-message" role="alert"><AlertIcon /><span>{error}</span></p>}
            <span className="sr-only" role="status">{status}</span>
            {ended ? (
              <div className="ended-session">
                <span>Session ended.</span>
                <button className="button primary" type="button" onClick={clearConversation}>Start new chat</button>
              </div>
            ) : (
              <form className="composer" onSubmit={(event) => void submit(event)}>
                {commandMatches.length > 0 && (
                  <div className="command-menu" aria-label="Commands">
                    {commandMatches.map((command) => (
                      <button key={command.name} type="button" className="command" onClick={() => { runCommand(command.name); textarea.current?.focus() }}>
                        <code>{command.name}</code><span>{command.description}</span>
                      </button>
                    ))}
                  </div>
                )}
                <label className="sr-only" htmlFor="message">Message</label>
                <textarea ref={textarea} id="message" placeholder={messages.length ? 'Ask a follow-up…' : 'Ask about a remedy or symptom…'} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onInputKeyDown} disabled={pending} aria-describedby="input-hint" />
                <button className="send-button" type="submit" disabled={pending || !draft.trim()} aria-label="Send message"><ArrowUpIcon /></button>
              </form>
            )}
            <div className="composer-footer">
              <span id="input-hint" className="sr-only">Enter to send, Shift + Enter for a new line.</span>
              <span className="disclaimer">Historical reference only — not medical advice.</span>
              <span className="app-version">v{version}</span>
            </div>
          </div>
        </div>
      </main>

      <BooksDialog open={booksOpen} onClose={() => setBooksOpen(false)} books={books} loading={booksLoading} error={booksError} onRetry={() => void refreshBooks()} selected={selectedBooks} onSelect={setSelectedBooks} />
    </div>
  )
}
