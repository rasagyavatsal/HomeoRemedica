import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ChatSummary, ClientConfig } from '../server/contracts.ts'
import { AccountControls } from './AccountControls.tsx'
import { errorMessage, getJson } from './api.ts'
import { type Account, type AuthClient, connectAuth } from './auth.ts'
import { AuthDialog } from './AuthDialog.tsx'
import { Composer, type ComposerHandle } from './Composer.tsx'
import { type Conversation, newConversation } from './conversation.ts'
import { CloseIcon, MenuIcon } from './icons.tsx'
import { AccountLibrary, type ChatLibrary, LocalLibrary, moveIntoAccount, openChat, summarize } from './library.ts'
import { Sidebar } from './Sidebar.tsx'
import { SourcesPanel } from './SourcesPanel.tsx'
import { Thread } from './Thread.tsx'
import { useChat } from './useChat.ts'
import { Welcome } from './Welcome.tsx'

export default function App() {
  const local = useMemo(() => new LocalLibrary(), [])
  const [auth, setAuth] = useState<AuthClient | null>(null)
  /** Undefined until it is known whether someone is signed in. */
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [accountLibrary, setAccountLibrary] = useState<AccountLibrary | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Accounts are optional: without them, or if they fail to load, chats stay in this browser.
  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    getJson<ClientConfig>('/api/config')
      .then(async ({ auth: config }) => {
        if (!config) return setAccount(null)
        const client = await connectAuth(config)
        if (!active) return
        setAuth(client)
        unsubscribe = client.subscribe(setAccount)
      })
      .catch(() => active && setAccount(null))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Signed in: move this browser's chats into the account before showing the account's.
  const uid = account?.uid
  useEffect(() => {
    setAccountLibrary(null)
    if (!uid || !auth) return
    let active = true
    const remote = new AccountLibrary(() => auth.token())
    moveIntoAccount(local, remote).then((failed) => {
      if (!active) return
      setAccountLibrary(remote)
      if (failed) setNotice(`${failed === 1 ? 'One chat' : `${failed} chats`} on this device could not be moved into your account.`)
    })
    return () => {
      active = false
    }
  }, [uid, auth, local])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  const library = account === undefined ? null : account ? accountLibrary : local
  const signOut = () => {
    auth?.signOut().catch((error: unknown) => setNotice(`Signing out failed. ${errorMessage(error)}`))
  }

  const deleteAccount = async () => {
    if (!accountLibrary || !auth) return
    await accountLibrary.deleteAccount()
    openChat.set(null)
    await auth.signOut().catch(() => {})
    setNotice('Your account and its chats were deleted.')
  }

  return (
    <>
      {/* A new account shows a fresh workspace, so one person's chat never stays open for the next. */}
      <Workspace
        key={uid ?? 'guest'}
        library={library}
        notify={setNotice}
        account={
          auth && (
            <AccountControls
              account={account}
              onSignIn={() => setSigningIn(true)}
              onSignOut={signOut}
              onDeleteAccount={deleteAccount}
            />
          )
        }
      />
      {signingIn && auth && <AuthDialog auth={auth} onClose={() => setSigningIn(false)} />}
      {notice && (
        <div className="toast" role="alert">
          <p>{notice}</p>
          <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <CloseIcon />
          </button>
        </div>
      )}
    </>
  )
}

/** The reference open in the sources panel: an answer and one of its sources. */
interface OpenSources {
  messageId: number
  source: number
}

interface WorkspaceProps {
  /** Where chats are saved; null while that is being worked out. */
  library: ChatLibrary | null
  notify: (message: string) => void
  /** Sign-in or account controls for the sidebar. */
  account?: ReactNode
}

/** The chats in one library and the open conversation. */
function Workspace({ library, notify: setNotice, account }: WorkspaceProps) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [reopen] = useState(() => openChat.get())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openSources, setOpenSources] = useState<OpenSources | null>(null)
  const composer = useRef<ComposerHandle>(null)
  const drawer = useMediaQuery('(max-width: 52rem)')

  const save = useCallback(
    (conversation: Conversation) => {
      if (!library || !conversation.messages.length) return
      setChats((list) => [summarize(conversation), ...(list ?? []).filter((chat) => chat.id !== conversation.id)])
      library.save(conversation).catch((error: unknown) => setNotice(`This chat could not be saved. ${errorMessage(error)}`))
    },
    [library, setNotice],
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
    setChats(null)
    if (!library) return
    let active = true
    library.list().then(
      (list) => active && setChats(list),
      (error: unknown) => {
        if (!active) return
        setChats([])
        setNotice(`Your chats could not be loaded. ${errorMessage(error)}`)
      },
    )
    if (reopen) {
      library.open(reopen).then(
        (saved) => active && saved && !current.current.messages.length && chat.open(saved),
        () => {},
      )
    }
    return () => {
      active = false
    }
  }, [library, reopen, chat.open, setNotice])

  // An empty chat leaves the remembered one alone: it may be a workspace that has not loaded yet.
  useEffect(() => {
    if (conversation.messages.length) openChat.set(conversation.id)
  }, [conversation.id, conversation.messages.length])

  const focusComposer = () => composer.current?.focus()

  const startNew = () => {
    openChat.set(null)
    chat.open(newConversation())
    setOpenSources(null)
    setSidebarOpen(false)
    focusComposer()
  }

  const openSaved = async (id: string) => {
    setSidebarOpen(false)
    if (!library || id === conversation.id) return
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
    if (!library) return
    try {
      await library.remove(id)
      setChats((list) => list?.filter((item) => item.id !== id) ?? null)
      if (id === current.current.id) startNew()
    } catch (error) {
      setNotice(`That chat could not be deleted. ${errorMessage(error)}`)
    }
  }

  // Clicking the open reference again closes the panel.
  const showSources = useCallback((messageId: number, source: number) => {
    setOpenSources((open) => (open?.messageId === messageId && open.source === source ? null : { messageId, source }))
  }, [])
  const closeSources = useCallback(() => setOpenSources(null), [])

  const openSource =
    openSources && conversation.messages.find((message) => message.id === openSources.messageId)?.sources?.[openSources.source - 1]
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

  return (
    <div className="app" data-sources={openSource ? 'open' : undefined} data-sidebar={sidebarShown ? 'open' : undefined}>
      <div className="sidebar-slot" inert={drawer && !sidebarOpen}>
        <Sidebar
          chats={chats}
          activeId={conversation.id}
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
        </header>

        <div className="scroller" ref={scroller}>
          <div className="reading">
            {conversation.messages.length ? (
              <Thread
                messages={conversation.messages}
                openSources={openSources ?? undefined}
                onSources={showSources}
                onRetry={chat.retry}
              />
            ) : (
              <Welcome />
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

      {openSources && openSource && (
        <>
          <div className="scrim scrim-sources" onClick={closeSources} aria-hidden="true" />
          <SourcesPanel key={openSource.id} source={openSource} number={openSources.source} onClose={closeSources} />
        </>
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
