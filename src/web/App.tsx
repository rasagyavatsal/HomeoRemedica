import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ChatSummary, ClientConfig } from '../server/contracts.ts'
import { AccountControls } from './AccountControls.tsx'
import { errorMessage, getJson } from './api.ts'
import { type Account, type AuthClient, authErrorMessage, connectAuth } from './auth.ts'
import { AuthDialog } from './AuthDialog.tsx'
import { Composer, type ComposerHandle } from './Composer.tsx'
import { type Conversation, newConversation } from './conversation.ts'
import { CloseIcon, MenuIcon } from './icons.tsx'
import { AccountLibrary, type ChatLibrary, LocalLibrary, moveIntoAccount, openChat, summarize } from './library.ts'
import { PractitionerNotice } from './PractitionerNotice.tsx'
import { Sidebar } from './Sidebar.tsx'
import { SourcesPanel } from './SourcesPanel.tsx'
import { Thread } from './Thread.tsx'
import { useChat } from './useChat.ts'
import { useFeedback } from './useFeedback.ts'
import { TAGLINE_WORDS, Welcome } from './Welcome.tsx'

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

  // Signed in with a verified email: move this browser's chats into the account before showing
  // the account's. Until the email is verified, chats stay in this browser.
  const uid = account?.verified ? account.uid : undefined
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

  // The verification link may be followed in another tab or on another device.
  const unverified = account && !account.verified ? account.uid : undefined
  useEffect(() => {
    if (!unverified || !auth) return
    setNotice('Verify your email address to sync your chats. The link is in your inbox.')
    const check = () => {
      if (document.visibilityState === 'visible') auth.refresh().catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [unverified, auth])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  // A change of account shows a fresh workspace, so one person's chat never stays open for the next.
  // Learning who is signed in as the app opens is no change, so a chat asked meanwhile stays.
  const [workspace, setWorkspace] = useState<{ known: boolean; uid?: string; key: number }>({ known: false, key: 0 })
  if (account !== undefined && (!workspace.known || workspace.uid !== uid)) {
    setWorkspace({ known: true, uid, key: workspace.known ? workspace.key + 1 : workspace.key })
  }

  const library = account === undefined ? null : uid ? accountLibrary : local
  const signOut = () => {
    auth?.signOut().catch((error: unknown) => setNotice(`Signing out failed. ${errorMessage(error)}`))
  }

  const resendVerification = () => {
    auth
      ?.sendVerification()
      .then(() => setNotice(`A new verification link was sent to ${account?.email ?? 'your email address'}.`))
      .catch((error: unknown) => setNotice(authErrorMessage(error) ?? 'The link could not be sent. Please try again.'))
  }

  // An unverified account has no account library yet, but can still be deleted.
  const deleteAccount = async () => {
    if (!auth) return
    await (accountLibrary ?? new AccountLibrary(() => auth.token())).deleteAccount()
    openChat.set(null)
    await auth.signOut().catch(() => {})
    setNotice('Your account and its chats were deleted.')
  }

  return (
    <>
      <Workspace
        key={workspace.key}
        library={library}
        notify={setNotice}
        account={
          <AccountControls
            account={account}
            onSignIn={auth ? () => setSigningIn(true) : undefined}
            onSignOut={signOut}
            onResendVerification={resendVerification}
            onDeleteAccount={deleteAccount}
          />
        }
      />
      {signingIn && auth && <AuthDialog auth={auth} onClose={() => setSigningIn(false)} />}
      <PractitionerNotice />
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
  /** The guest or account profile for the sidebar. */
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

  // Chats answered before there is a library to save to, saved once there is one.
  const unsaved = useRef(new Map<string, Conversation>())
  const save = useCallback(
    (conversation: Conversation) => {
      if (!conversation.messages.length) return
      if (!library) {
        unsaved.current.set(conversation.id, conversation)
        return
      }
      setChats((list) => [summarize(conversation), ...(list ?? []).filter((chat) => chat.id !== conversation.id)])
      library.save(conversation).catch((error: unknown) => setNotice(`This chat could not be saved. ${errorMessage(error)}`))
    },
    [library, setNotice],
  )
  const chat = useChat(save)
  const { conversation } = chat
  // Ratings are kept with the account, so only a verified account can give them.
  const ratingClient = library instanceof AccountLibrary ? library : null
  const feedback = useFeedback(conversation, ratingClient, setNotice)
  const scroller = useFollow(conversation.messages)
  const composerArea = useComposerHeight()
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
    const saving = [...unsaved.current.values()].map((conversation) =>
      library.save(conversation).catch((error: unknown) => setNotice(`This chat could not be saved. ${errorMessage(error)}`)),
    )
    unsaved.current.clear()
    // Listed once those are saved, so the list includes them.
    Promise.all(saving)
      .then(() => library.list())
      .then(
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

  const openMessage = openSources && conversation.messages.find((message) => message.id === openSources.messageId)
  const openSource = openSources && openMessage?.sources?.[openSources.source - 1]
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
                onConfirm={chat.confirm}
                ratings={feedback.ratings}
                onRate={ratingClient ? feedback.rate : undefined}
                onNote={ratingClient ? feedback.note : undefined}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </div>

        <footer ref={composerArea} className="composer-area" style={{ '--tagline-words': TAGLINE_WORDS } as CSSProperties}>
          <div className="reading">
            <Composer
              ref={composer}
              busy={chat.busy}
              onAsk={chat.ask}
              onStop={chat.stop}
            />
          </div>
        </footer>
      </main>

      {openSources && openSource && (
        <>
          <div className="scrim scrim-sources" onClick={closeSources} aria-hidden="true" />
          <SourcesPanel
            key={openSource.id}
            source={openSource}
            number={openSources.source}
            onClose={closeSources}
            rating={feedback.ratings.get(openSources.messageId)?.sources[openSources.source] ?? null}
            onRate={
              ratingClient && !openMessage?.status
                ? (rating) => feedback.rate(openSources.messageId, openSources.source, rating)
                : undefined
            }
          />
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

/**
 * Publish the composer area's height as `--composer-height`, so the toast can sit above the composer
 * rather than over the question box and its send button.
 */
function useComposerHeight() {
  const element = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const root = document.documentElement.style
    const observer = new ResizeObserver(() => root.setProperty('--composer-height', `${node.offsetHeight}px`))
    observer.observe(node)
    return () => {
      observer.disconnect()
      root.removeProperty('--composer-height')
    }
  }, [])

  return element
}
