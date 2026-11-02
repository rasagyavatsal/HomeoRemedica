import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { version } from '../../package.json'
import { loadBooks, sendMessage } from './api'
import type { Book, Source, Turn } from './api'
import { Answer } from './Answer'
import {
  type ChatSummary,
  type Conversation,
  INDEX_KEY,
  type Message,
  chatTitle,
  deleteAllChats,
  deleteChat,
  listChats,
  loadChat,
  migrateLegacyConversation,
  openChatId,
  rememberOpenChat,
  saveChat,
} from './chats'
import { AlertIcon, ArrowUpIcon, MarkIcon, PlusIcon, SidebarIcon } from './icons'
import { Sidebar } from './Sidebar'

/** The question in flight and the part of its answer streamed so far. */
interface LiveExchange {
  question: string
  content: string
  sources: readonly Source[]
}

const COMMANDS = [
  { name: '/clear', description: 'Start a new chat' },
  { name: '/delete', description: 'Delete this chat' },
  { name: '/quit', description: 'End this session' },
] as const

const SUGGESTIONS = [
  'What are the keynote symptoms of Arsenicum album?',
  'Compare Bryonia and Rhus toxicodendron for joint pain.',
  'Which remedies are worse from cold, damp weather?',
  'How is the Pulsatilla temperament described?',
]

const SIDEBAR_ID = 'chat-sidebar'
const SIDEBAR_HIDDEN_KEY = 'homeoremedica:sidebar-hidden'
/** Wide enough to show the sidebar beside the conversation; narrower screens use a drawer. */
const WIDE_QUERY = '(min-width: 900px)'

interface OpenChat extends Conversation {
  id: string | null
}

/** Reopen the chat this tab had open before a reload. */
function restoreOpenChat(): OpenChat {
  migrateLegacyConversation()
  const id = openChatId()
  const saved = id === null ? null : loadChat(id)
  return saved ? { id, ...saved } : { id: null, messages: [], history: [] }
}

function nextMessageId(messages: readonly Message[]) {
  return Math.max(-1, ...messages.map((message) => message.id)) + 1
}

function useWideScreen() {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? true)
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_QUERY)
    if (!query) return
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

function loadSidebarHidden() {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function saveSidebarHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(SIDEBAR_HIDDEN_KEY, 'true')
    else localStorage.removeItem(SIDEBAR_HIDDEN_KEY)
  } catch {
    // The sidebar shows again on the next visit.
  }
}

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
  const [saved] = useState(restoreOpenChat)
  const [chatId, setChatId] = useState(saved.id)
  const [chats, setChats] = useState<ChatSummary[]>(listChats)
  const [books, setBooks] = useState<readonly Book[]>([])
  const [messages, setMessages] = useState<Message[]>(saved.messages)
  const [history, setHistory] = useState<Turn[]>(saved.history)
  const wide = useWideScreen()
  const [sidebarHidden, setSidebarHidden] = useState(loadSidebarHidden)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const sidebarToggle = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState<LiveExchange | null>(null)
  const [error, setError] = useState('')
  const [ended, setEnded] = useState(false)
  const [status, setStatus] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const latestQuestion = useRef<HTMLElement>(null)
  const nextId = useRef(nextMessageId(saved.messages))
  const requestInFlight = useRef(false)

  // The catalog only decorates the empty state, so a failed load leaves the generic copy in place.
  useEffect(() => {
    const controller = new AbortController()
    loadBooks(controller.signal).then((response) => setBooks(response.books), () => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 200)}px`
  }, [draft, ended])

  const pending = live !== null
  const drawer = !wide && drawerOpen
  const sidebarVisible = wide ? !sidebarHidden : drawerOpen
  const canStartNew = messages.length > 0 || draft !== '' || ended

  useEffect(() => rememberOpenChat(chatId), [chatId])

  // Chats asked or deleted in another tab show up in this tab's list.
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === null || event.key === INDEX_KEY) setChats(listChats())
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  // The drawer closes with Escape and gives focus back to the button that opened it.
  useEffect(() => {
    if (!drawer) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawer])

  // Bring each new exchange to the top of the view so long answers read from their start.
  useEffect(() => {
    latestQuestion.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [messages, pending])

  function closeDrawer() {
    setDrawerOpen(false)
    requestAnimationFrame(() => sidebarToggle.current?.focus())
  }

  function toggleSidebar() {
    if (!wide) {
      setDrawerOpen(true)
      return
    }
    setSidebarHidden(!sidebarHidden)
    saveSidebarHidden(!sidebarHidden)
  }

  /** Show a chat, or an empty new chat when `chat` has no id. */
  function showChat(chat: OpenChat, status: string) {
    if (requestInFlight.current) return
    setChatId(chat.id)
    setMessages(chat.messages)
    setHistory(chat.history)
    nextId.current = nextMessageId(chat.messages)
    setDraft('')
    setError('')
    setEnded(false)
    setStatus(status)
    setDrawerOpen(false)
    window.scrollTo?.({ top: 0 })
    requestAnimationFrame(() => textarea.current?.focus())
  }

  function startNewChat() {
    showChat({ id: null, messages: [], history: [] }, 'Started a new chat.')
  }

  function openChat(id: string) {
    if (id === chatId) {
      setDrawerOpen(false)
      return
    }
    const chat = loadChat(id)
    if (chat) {
      showChat({ id, ...chat }, 'Opened chat.')
    } else {
      setChats(deleteChat(id))
      setError('That chat could not be opened, so it was removed from the list.')
    }
  }

  function removeChat(id: string) {
    if (requestInFlight.current) return
    setChats(deleteChat(id))
    if (id === chatId) startNewChat()
    setStatus('Chat deleted.')
  }

  function removeAllChats() {
    if (requestInFlight.current) return
    deleteAllChats()
    setChats([])
    if (chatId !== null) startNewChat()
    setStatus('All chats deleted.')
  }

  function runCommand(command: string) {
    setError('')
    if (command === '/clear') {
      startNewChat()
    } else if (command === '/delete') {
      if (chatId === null) startNewChat()
      else removeChat(chatId)
    } else if (command === '/quit' || command === '/exit') {
      setEnded(true)
      setDraft('')
    } else {
      setError('Unknown command. Use /clear, /delete or /quit.')
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
    setLive({ question: message, content: '', sources: [] })
    try {
      const response = await sendMessage(message, history, {
        onSources: (sources) => setLive((current) => current && { ...current, sources }),
        onText: (text) => setLive((current) => current && { ...current, content: current.content + text }),
      })
      // Chats cannot be switched while a request is in flight, so `messages` is still current.
      const updated: Message[] = [...messages,
        { id: nextId.current++, role: 'user', content: message },
        { id: nextId.current++, role: 'assistant', content: response.answer, sources: response.sources },
      ]
      const id = chatId ?? crypto.randomUUID()
      setMessages(updated)
      setHistory(response.history)
      setChatId(id)
      setChats(saveChat({ id, title: chatTitle(updated), updatedAt: Date.now(), messages: updated, history: response.history }))
      setDraft('')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      requestInFlight.current = false
      setLive(null)
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
    <div className={`app-layout ${sidebarVisible && wide ? 'with-sidebar' : ''}`}>
      {sidebarVisible && (
        <Sidebar
          id={SIDEBAR_ID}
          chats={chats}
          activeId={chatId}
          busy={pending}
          canStartNew={canStartNew}
          drawer={drawer}
          onNew={startNewChat}
          onOpen={openChat}
          onDelete={removeChat}
          onDeleteAll={removeAllChats}
          onClose={closeDrawer}
        />
      )}
      {drawer && <div className="sidebar-backdrop" onClick={closeDrawer} aria-hidden="true" />}
      <div className="app-shell" inert={drawer}>
        <header className="header">
          <div className="header-start">
            <button ref={sidebarToggle} className="icon-button" type="button" onClick={toggleSidebar} aria-controls={SIDEBAR_ID} aria-expanded={sidebarVisible} aria-label={sidebarVisible ? 'Hide chats' : 'Show chats'} title={sidebarVisible ? 'Hide chats' : 'Show chats'}>
              <SidebarIcon />
            </button>
            <a className="wordmark" href="/" aria-label="HomeoRemedica home">
              <span className="wordmark-mark"><MarkIcon /></span>
              <span>Homeo<span className="wordmark-accent">Remedica</span></span>
            </a>
          </div>
          {!(sidebarVisible && wide) && (
            <div className="header-actions">
              <button className="button quiet" type="button" onClick={startNewChat} disabled={pending || !canStartNew} aria-label="New chat" title="New chat">
                <PlusIcon /><span className="button-text">New chat</span>
              </button>
            </div>
          )}
        </header>

        <main className="main">
          <div className={`conversation ${empty ? 'conversation-empty' : ''}`} aria-label="Conversation" role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending}>
            {empty && !ended && <EmptyState books={books} onAsk={(question) => void submit(undefined, question)} />}
            {messages.map((message) => message.role === 'user' ? (
              <article className="message message-user" key={message.id} ref={!live && message.id === lastUserId ? latestQuestion : undefined}>
                <h2 className="sr-only">You</h2>
                <div className="user-content">{message.content}</div>
              </article>
            ) : (
              <article className="message message-assistant" key={message.id}>
                <h2 className="message-label"><span className="avatar"><MarkIcon size={14} /></span>HomeoRemedica</h2>
                <Answer id={message.id} content={message.content} sources={message.sources ?? []} />
              </article>
            ))}
            {live && (
              <>
                <article className="message message-user" ref={latestQuestion}>
                  <h2 className="sr-only">You</h2>
                  <div className="user-content">{live.question}</div>
                </article>
                {live.content ? (
                  <article className="message message-assistant">
                    <h2 className="message-label"><span className="avatar avatar-pulse"><MarkIcon size={14} /></span>HomeoRemedica</h2>
                    <Answer id={nextId.current + 1} content={live.content} sources={live.sources} />
                  </article>
                ) : (
                  <div className="message message-assistant request-progress" role="status">
                    <span className="message-label"><span className="avatar avatar-pulse"><MarkIcon size={14} /></span>Preparing an answer…</span>
                    <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="composer-area">
            <div className="composer-stack">
              {error && <p className="error-message" role="alert"><AlertIcon /><span>{error}</span></p>}
              <span className="sr-only" role="status">{status}</span>
              {ended ? (
                <div className="ended-session">
                  <span>Session ended.</span>
                  <button className="button primary" type="button" onClick={startNewChat}>Start new chat</button>
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
                <span className="disclaimer">Historical reference only — not medical advice. For health decisions, consult a qualified clinician.</span>
                <span className="app-version">v{version}</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
