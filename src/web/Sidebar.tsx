import { useEffect, useRef, useState } from 'react'
import type { User } from './account'
import type { ChatSummary } from './chats'
import { CloseIcon, PlusIcon, TrashIcon } from './icons'

const DAY = 24 * 60 * 60 * 1000

/** Group chats under Today, Yesterday, Previous 7 days and Older, keeping their order. */
export function groupChats(chats: readonly ChatSummary[], now = Date.now()) {
  const today = new Date(now).setHours(0, 0, 0, 0)
  const groups = new Map<string, ChatSummary[]>()
  for (const chat of chats) {
    const label = chat.updatedAt >= today ? 'Today'
      : chat.updatedAt >= today - DAY ? 'Yesterday'
        : chat.updatedAt >= today - 7 * DAY ? 'Previous 7 days'
          : 'Older'
    groups.set(label, [...groups.get(label) ?? [], chat])
  }
  return [...groups]
}

interface SidebarProps {
  id: string
  chats: readonly ChatSummary[]
  activeId: string | null
  /** Switching chats waits for the answer in progress. */
  busy: boolean
  canStartNew: boolean
  /** Shown as a drawer over the chat on narrow screens. */
  drawer: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onDeleteAll: () => void
  onClose: () => void
  /** The signed-in user, or null when chats are kept on this device. */
  user: User | null
  /** Whether this server offers accounts. */
  canSignIn: boolean
  /** The account's chats are still on their way. */
  loading: boolean
  onSignIn: () => void
  onSignOut: () => void
  onDeleteAccount: () => void
}

export function Sidebar({
  id, chats, activeId, busy, canStartNew, drawer, onNew, onOpen, onDelete, onDeleteAll, onClose,
  user, canSignIn, loading, onSignIn, onSignOut, onDeleteAccount,
}: SidebarProps) {
  const [confirming, setConfirming] = useState<'chats' | 'account' | null>(null)
  const sidebar = useRef<HTMLElement>(null)

  // Move focus into the drawer when it opens; the rest of the page is inert behind it.
  useEffect(() => {
    if (drawer) sidebar.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus()
  }, [drawer])

  useEffect(() => {
    if (!chats.length) setConfirming((current) => (current === 'chats' ? null : current))
  }, [chats.length])

  useEffect(() => setConfirming(null), [user?.id])

  return (
    <aside ref={sidebar} id={id} className={`sidebar ${drawer ? 'sidebar-drawer' : ''}`} aria-label="Your chats" role={drawer ? 'dialog' : undefined} aria-modal={drawer || undefined}>
      <div className="sidebar-top">
        <button className="button sidebar-new" type="button" onClick={onNew} disabled={busy || !canStartNew}>
          <PlusIcon />New chat
        </button>
        {drawer && <button className="icon-button" type="button" onClick={onClose} aria-label="Close chats"><CloseIcon /></button>}
      </div>

      <nav className="sidebar-list" aria-label="Past chats">
        {chats.length === 0 ? (
          <p className="sidebar-empty">{loading ? 'Loading your chats…' : 'Your chats will appear here.'}</p>
        ) : groupChats(chats).map(([label, group]) => (
          <section key={label} className="sidebar-group">
            <h2 className="sidebar-heading">{label}</h2>
            <ul>
              {group.map((chat) => (
                <li key={chat.id} className={`chat-row ${chat.id === activeId ? 'chat-row-active' : ''}`}>
                  <button className="chat-link" type="button" onClick={() => onOpen(chat.id)} disabled={busy} aria-current={chat.id === activeId ? 'page' : undefined} title={chat.title}>
                    {chat.title}
                  </button>
                  <button className="chat-delete" type="button" onClick={() => onDelete(chat.id)} disabled={busy} aria-label={`Delete chat: ${chat.title}`} title="Delete chat">
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <div className="sidebar-footer">
        {user ? (
          <>
            <p className="account-email" title={user.email}>{user.email}</p>
            <p>Chats are saved to your account.</p>
          </>
        ) : (
          <p>
            Chats are saved on this device only.
            {canSignIn && <> <button className="text-button" type="button" onClick={onSignIn}>Sign in</button> to keep them in an account.</>}
          </p>
        )}
        {chats.length > 0 && (confirming === 'chats' ? (
          <div className="delete-all-confirm" role="group" aria-label="Delete all chats?">
            <span>Delete all chats?</span>
            <button className="text-button danger" type="button" onClick={() => { setConfirming(null); onDeleteAll() }} disabled={busy}>Delete</button>
            <button className="text-button" type="button" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        ) : (
          <button className="text-button danger" type="button" onClick={() => setConfirming('chats')} disabled={busy}>Delete all chats</button>
        ))}
        {user && (confirming === 'account' ? (
          <div className="delete-all-confirm account-confirm" role="group" aria-label="Delete your account and its chats?">
            <span>Delete your account and its chats?</span>
            <button className="text-button danger" type="button" onClick={() => { setConfirming(null); onDeleteAccount() }} disabled={busy}>Delete account</button>
            <button className="text-button" type="button" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        ) : (
          <div className="account-actions">
            <button className="text-button" type="button" onClick={onSignOut} disabled={busy}>Sign out</button>
            <span aria-hidden="true">·</span>
            <button className="text-button danger" type="button" onClick={() => setConfirming('account')} disabled={busy}>Delete account</button>
          </div>
        ))}
      </div>
    </aside>
  )
}
