import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { loadBooks, sendMessage } from './api'
import type { Book, Source, Turn } from './api'

interface Message extends Turn {
  id: number
  sources?: readonly Source[]
}

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function BookIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function Sources({ sources }: { sources: readonly Source[] }) {
  if (!sources.length) return null
  return (
    <details className="sources">
      <summary>Sources <span>{sources.length}</span></summary>
      <div className="source-list">
        {sources.map((source, index) => (
          <details className="source" key={source.id}>
            <summary>
              <span className="source-number">{index + 1}</span>
              <span><strong>{source.bookTitle}</strong><span className="source-location">{source.remedyName} · {source.sectionTitle}</span></span>
            </summary>
            <div className="source-content">
              {source.author && <p className="source-author">{source.author}</p>}
              <p className="source-text">{source.text}</p>
              <code>{source.id}</code>
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.'
}

export default function App() {
  const [books, setBooks] = useState<readonly Book[]>([])
  const [booksLoading, setBooksLoading] = useState(true)
  const [booksError, setBooksError] = useState('')
  const [selectedBooks, setSelectedBooks] = useState<string[] | null>(null)
  const [metadata, setMetadata] = useState({ corpusVersion: '', model: '' })
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState(false)
  const [status, setStatus] = useState('')
  const [booksOpen, setBooksOpen] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const nextId = useRef(0)
  const requestInFlight = useRef(false)

  async function refreshBooks(signal?: AbortSignal) {
    setBooksLoading(true)
    setBooksError('')
    try {
      const response = await loadBooks(signal)
      if (signal?.aborted) return
      setBooks(response.books)
      setMetadata({ corpusVersion: response.corpusVersion, model: response.model })
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
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`
  }, [draft, ended])

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, pending, error, ended])

  useEffect(() => {
    if (booksOpen) dialog.current?.showModal()
    else if (dialog.current?.open) dialog.current.close()
  }, [booksOpen])

  function clearConversation() {
    if (requestInFlight.current) return
    setMessages([])
    setHistory([])
    setDraft('')
    setError('')
    setEnded(false)
    setStatus('Conversation cleared.')
    textarea.current?.focus()
  }

  function toggleBook(bookId: string) {
    const current = selectedBooks ?? []
    if (current.includes(bookId)) {
      const updated = current.filter((id) => id !== bookId)
      setSelectedBooks(updated.length ? updated : null)
    } else if (current.length < 4) {
      setSelectedBooks([...current, bookId])
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const message = draft.trim()
    if (!message || requestInFlight.current || ended) return
    setError('')
    setStatus('')
    if (message.startsWith('/')) {
      if (message === '/books') {
        setBooksOpen(true)
        setDraft('')
      } else if (message === '/clear') {
        clearConversation()
      } else if (message === '/quit' || message === '/exit') {
        setEnded(true)
        setDraft('')
      } else {
        setError('Unknown command. Use /books, /clear, or /quit.')
      }
      return
    }
    requestInFlight.current = true
    setPending(true)
    try {
      const response = await sendMessage(message, history, selectedBooks)
      setMessages((previous) => [...previous,
        { id: nextId.current++, role: 'user', content: message },
        { id: nextId.current++, role: 'assistant', content: response.answer, sources: response.sources },
      ])
      setHistory(response.history)
      setMetadata({ corpusVersion: response.corpusVersion, model: response.model })
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

  const bookLabel = selectedBooks ? `${selectedBooks.length} selected` : 'All books'

  return (
    <div className="app-shell">
      <header className="header">
        <a className="wordmark" href="/" aria-label="HomeoRemedica home">HomeoRemedica<span className="wordmark-dot" aria-hidden="true">.</span></a>
        <div className="header-actions">
          <button className="button books-button" onClick={() => setBooksOpen(true)} disabled={pending} aria-haspopup="dialog"><BookIcon /><span>{bookLabel}</span></button>
          <button className="button quiet" onClick={clearConversation} disabled={pending || (!messages.length && !draft && !ended)} aria-label="Clear conversation">Clear</button>
        </div>
      </header>

      <main className="main">
        <div className={`conversation ${messages.length ? '' : 'conversation-empty'}`} aria-label="Conversation" role="log" aria-live="polite" aria-relevant="additions">
          {!messages.length && !pending && <div className="empty-state"><h1>Ask a question.</h1></div>}
          <div className="messages">
            {messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <div className="message-label">{message.role === 'user' ? 'You' : 'HomeoRemedica'}</div>
                {message.role === 'user' ? <div className="user-content">{message.content}</div> : <>
                  <div className="answer"><ReactMarkdown skipHtml>{message.content}</ReactMarkdown></div>
                  <Sources sources={message.sources ?? []} />
                </>}
              </article>
            ))}
            {pending && <div className="request-progress" role="status"><span className="progress-dot" />Preparing an answer…</div>}
            <div ref={bottom} />
          </div>
        </div>

        <div className="composer-area">
          {error && <p className="error-message" role="alert">{error}</p>}
          <span className="sr-only" role="status">{status}</span>
          {ended ? <div className="ended-session"><span>Session ended.</span><button className="button primary" onClick={clearConversation}>Start new chat</button></div> : (
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor="message">Message</label>
              <textarea ref={textarea} id="message" placeholder="Message HomeoRemedica" rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onInputKeyDown} disabled={pending} aria-describedby="input-hint" />
              <button className="send-button" type="submit" disabled={pending || !draft.trim()} aria-label="Send message"><ArrowIcon /></button>
            </form>
          )}
          <div className="composer-footer"><span id="input-hint">{ended ? '' : 'Enter to send · Shift + Enter for a new line'}</span>{metadata.corpusVersion && <span className="metadata" title={`Corpus ${metadata.corpusVersion} · ${metadata.model}`}>{metadata.model}<span aria-hidden="true"> · </span>{metadata.corpusVersion}</span>}</div>
        </div>
      </main>

      <dialog ref={dialog} className="books-dialog" aria-labelledby="books-title" onCancel={() => setBooksOpen(false)} onClose={() => setBooksOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setBooksOpen(false) }}>
        <div className="dialog-header"><div><h2 id="books-title">Books</h2><p>All books, or select up to four.</p></div><button className="close-button" onClick={() => setBooksOpen(false)} aria-label="Close books">×</button></div>
        {booksLoading ? <p className="books-status" role="status">Loading books…</p> : booksError ? <div className="books-status"><p role="alert">{booksError}</p><button className="button" onClick={() => void refreshBooks()}>Retry</button></div> : <>
          <label className="all-books"><input type="checkbox" checked={selectedBooks === null} onChange={() => setSelectedBooks(null)} />All books</label>
          <div className="books-list">
            {books.map((book) => (
              <label className="book-option" key={book.bookId}>
                <input type="checkbox" checked={selectedBooks?.includes(book.bookId) ?? false} disabled={selectedBooks?.length === 4 && !selectedBooks.includes(book.bookId)} onChange={() => toggleBook(book.bookId)} />
                <span>
                  <strong>{book.title}</strong>{' '}
                  {book.author && <><span className="book-author">{book.author}</span>{' '}</>}
                  <code className="book-id">{book.bookId}</code>
                </span>
              </label>
            ))}
            {!books.length && <p className="books-status">No books available.</p>}
          </div>
        </>}
        <div className="dialog-footer"><span>{bookLabel}</span><button className="button primary" onClick={() => setBooksOpen(false)}>Done</button></div>
      </dialog>
    </div>
  )
}
