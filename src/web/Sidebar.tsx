import { type ReactNode, useState } from 'react'

import type { ChatSummary } from '../server/contracts.ts'
import { CloseIcon, LeafMark, PlusIcon, SearchIcon, TrashIcon } from './icons.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

interface SidebarProps {
  /** Saved chats, newest first; null while they load. */
  chats: readonly ChatSummary[] | null
  activeId: string
  /** Where the chats are kept, such as "On this device". */
  place: string
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
  /** Sign-in or account controls. */
  footer?: ReactNode
}

const SEARCH_FROM = 6

export function Sidebar({ chats, activeId, place, onNew, onOpen, onDelete, onClose, footer }: SidebarProps) {
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const filtered = chats?.filter((chat) => chat.title.toLowerCase().includes(query.trim().toLowerCase())) ?? []

  return (
    <nav className="sidebar" aria-label="Chats">
      <div className="sidebar-header">
        <div className="brand">
          <LeafMark />
          <span className="brand-name">HomeoRemedica</span>
        </div>
        <div className="sidebar-tools">
          <ThemeToggle />
          <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Close chats">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="button button-outline new-chat" onClick={onNew}>
          <PlusIcon /> New chat
        </button>
        {chats && chats.length >= SEARCH_FROM && (
          <label className="sidebar-search">
            <SearchIcon />
            <span className="visually-hidden">Search chats</span>
            <input type="search" value={query} placeholder="Search chats" onChange={(event) => setQuery(event.target.value)} />
          </label>
        )}
      </div>

      <div className="sidebar-chats">
        {chats === null ? (
          <p className="sidebar-empty" role="status">
            Loading chats…
          </p>
        ) : chats.length === 0 ? (
          <p className="sidebar-empty">Your chats will appear here.</p>
        ) : filtered.length === 0 ? (
          <p className="sidebar-empty">No chats match “{query.trim()}”.</p>
        ) : (
          groupByAge(filtered).map(({ label, chats: group }) => (
            <section key={label} className="chat-group" aria-label={label}>
              <h2 className="eyebrow chat-group-label">{label}</h2>
              <ul className="chat-list">
                {group.map((chat) =>
                  confirming === chat.id ? (
                    <li key={chat.id} className="chat-item chat-item-confirm">
                      <span>Delete this chat?</span>
                      <button
                        type="button"
                        className="button button-danger button-small"
                        onClick={() => {
                          setConfirming(null)
                          onDelete(chat.id)
                        }}
                        autoFocus
                      >
                        Delete
                      </button>
                      <button type="button" className="button button-quiet button-small" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </li>
                  ) : (
                    <li key={chat.id} className="chat-item" data-active={chat.id === activeId || undefined}>
                      <button
                        type="button"
                        className="chat-link"
                        onClick={() => onOpen(chat.id)}
                        aria-current={chat.id === activeId ? 'page' : undefined}
                      >
                        {chat.title}
                      </button>
                      <button
                        type="button"
                        className="icon-button chat-delete"
                        onClick={() => setConfirming(chat.id)}
                        aria-label={`Delete “${chat.title}”`}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <p className="sidebar-place">{place}</p>
        {footer}
      </div>
    </nav>
  )
}

const DAY = 24 * 60 * 60 * 1000

/** Split chats, newest first, into Today, Yesterday, Previous 7 days and Older. */
export function groupByAge(chats: readonly ChatSummary[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const bounds: [string, number][] = [
    ['Today', today],
    ['Yesterday', today - DAY],
    ['Previous 7 days', today - 7 * DAY],
    ['Older', -Infinity],
  ]
  const groups: { label: string; chats: ChatSummary[] }[] = []
  for (const chat of chats) {
    const label = bounds.find(([, start]) => chat.updatedAt >= start)?.[0] ?? 'Older'
    const last = groups.at(-1)
    if (last?.label === label) last.chats.push(chat)
    else groups.push({ label, chats: [chat] })
  }
  return groups
}
