import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ChatSummary } from '../server/contracts.ts'
import { errorMessage } from './api.ts'
import { Composer, type ComposerHandle } from './Composer.tsx'
import { type Conversation, citedSources, newConversation } from './conversation.ts'
import { CloseIcon, MenuIcon, PlusIcon } from './icons.tsx'
import { type ChatLibrary, LocalLibrary, openChat, summarize } from './library.ts'
import { Sidebar } from './Sidebar.tsx'
import { SourcesPanel } from './SourcesPanel.tsx'
import { Thread } from './Thread.tsx'
import { useChat } from './useChat.ts'
import { Welcome } from './Welcome.tsx'

export default function App() {
  const library = useMemo(() => new LocalLibrary(), [])
  return <Workspace library={library} place="Chats are saved on this device." />
}

/** Which answer's sources are open, and the source to show. */
interface OpenSources {
  messageId: number
  source?: number
}

interface WorkspaceProps {
  library: ChatLibrary
  /** Where `library` keeps chats, in a sentence. */
  place: string
  /** Sign-in or account controls for the sidebar. */
  account?: ReactNode
}

/** The chats in one library and the open conversation. */
export function Workspace({ library, place, account }: WorkspaceProps) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openSources, setOpenSources] = useState<OpenSources | null>(null)
  const composer = useRef<ComposerHandle>(null)
  const drawer = useMediaQuery('(max-width: 52rem)')

  const save = useCallback(
    (conversation: Conversation) => {
      if (!conversation.messages.length) return
      setChats((list) => [summarize(conversation), ...(list ?? []).filter((chat) => chat.id !== conversation.id)])
      library.save(conversation).catch((error: unknown) => setNotice(`This chat could not be saved. ${errorMessage(error)}`))
    },
    [library],
  )
  const chat = useChat(save)
  const { conversation } = chat
  const scroller = useFollow(conversation.messages)
  // The open chat, for callbacks that finish after it may have changed.
  const current = useRef(conversation)
  useEffect(() => {
    current.current = conversation
  })

  // Load the chat list, and reopen the chat this tab had open before a reload.
  useEffect(() => {
    let active = true
    library.list().then(
      (list) => active && setChats(list),
      (error: unknown) => {
        if (!active) return
        setChats([])
        setNotice(`Your chats could not be loaded. ${errorMessage(error)}`)
      },
    )
    const reopen = openChat.get()
    if (reopen) {
      library.open(reopen).then(
        (saved) => active && saved && !current.current.messages.length && chat.open(saved),
        () => {},
      )
    }
    return () => {
      active = false
    }
  }, [library, chat.open])

  useEffect(() => {
    openChat.set(conversation.messages.length ? conversation.id : null)
  }, [conversation.id, conversation.messages.length])

  const focusComposer = () => composer.current?.focus()

  const startNew = () => {
    chat.open(newConversation())
    setOpenSources(null)
    setSidebarOpen(false)
    focusComposer()
  }

  const openSaved = async (id: string) => {
    setSidebarOpen(false)
    if (id === conversation.id) return
    try {
      const saved = await library.open(id)
      if (!saved) {
        setChats((list) => list?.filter((item) => item.id !== id) ?? null)
        setNotice('That chat no longer exists.')
        return
      }
      chat.open(saved)
      setOpenSources(null)
    } catch (error) {
      setNotice(`That chat could not be opened. ${errorMessage(error)}`)
    }
  }

  const remove = async (id: string) => {
    try {
      await library.remove(id)
      setChats((list) => list?.filter((item) => item.id !== id) ?? null)
      if (id === current.current.id) startNew()
    } catch (error) {
      setNotice(`That chat could not be deleted. ${errorMessage(error)}`)
    }
  }

  const showSources = useCallback((messageId: number, source?: number) => {
    setOpenSources((open) =>
      source === undefined && open?.messageId === messageId && open.source === undefined ? null : { messageId, source },
    )
  }, [])
  const closeSources = useCallback(() => setOpenSources(null), [])

  const ask = useCallback(
    (question: string) => {
      chat.ask(question)
      composer.current?.focus()
    },
    [chat.ask],
  )

  const sourcesFor = openSources && conversation.messages.find((message) => message.id === openSources.messageId)
  const sidebarShown = sidebarOpen && drawer

  useEffect(() => {
    if (!openSources && !sidebarShown) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpenSources(null)
      setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSources, sidebarShown])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <div className="app" data-sources={sourcesFor?.sources ? 'open' : undefined} data-sidebar={sidebarShown ? 'open' : undefined}>
      <div className="sidebar-slot" inert={drawer && !sidebarOpen}>
        <Sidebar
          chats={chats}
          activeId={conversation.id}
          place={place}
          onNew={startNew}
          onOpen={openSaved}
          onDelete={remove}
          onClose={() => setSidebarOpen(false)}
          footer={account}
        />
      </div>
      {sidebarShown && <div className="scrim scrim-sidebar" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main className="main" inert={sidebarShown}>
        <header className="topbar">
          <button type="button" className="icon-button topbar-menu" onClick={() => setSidebarOpen(true)} aria-label="Open chats">
            <MenuIcon />
          </button>
          <p className="topbar-title">{conversation.title || 'New chat'}</p>
          <button type="button" className="icon-button" onClick={startNew} aria-label="New chat" title="New chat">
            <PlusIcon />
          </button>
        </header>

        <div className="scroller" ref={scroller}>
          <div className="reading">
            {conversation.messages.length ? (
              <Thread
                messages={conversation.messages}
                openSources={openSources?.messageId}
                onSources={showSources}
                onRetry={chat.retry}
              />
            ) : (
              <Welcome onAsk={ask} />
            )}
          </div>
        </div>

        <footer className="composer-area">
          <div className="reading">
            <Composer ref={composer} busy={chat.busy} onAsk={chat.ask} onStop={chat.stop} />
            <p className="disclaimer">Historical reference only — not medical advice. For symptoms, see a qualified practitioner.</p>
          </div>
        </footer>
      </main>

      {sourcesFor?.sources && (
        <>
          <div className="scrim scrim-sources" onClick={closeSources} aria-hidden="true" />
          <SourcesPanel
            sources={sourcesFor.sources}
            cited={citedSources(sourcesFor.content)}
            active={openSources?.source}
            onClose={closeSources}
          />
        </>
      )}

      {notice && (
        <div className="toast" role="alert">
          <p>{notice}</p>
          <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

/**
 * Keep a scroll container at its end as messages stream in, unless the reader has scrolled up.
 * A new question, or another chat, always scrolls to the end.
 */
function useFollow(messages: readonly unknown[]) {
  const element = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const count = useRef(messages.length)

  useEffect(() => {
    const node = element.current
    if (!node) return
    const onScroll = () => {
      atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const node = element.current
    const changed = messages.length !== count.current
    count.current = messages.length
    if (node && (atEnd.current || changed)) node.scrollTop = node.scrollHeight
  }, [messages])

  return element
}
