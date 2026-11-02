import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { errorMessage } from './api.ts'
import type { Account } from './auth.ts'
import { Dialog } from './Dialog.tsx'
import { SignOutIcon, TrashIcon, UserIcon } from './icons.tsx'

interface AccountControlsProps {
  /** The signed-in account, null when signed out, or undefined while that is unknown. */
  account: Account | null | undefined
  onSignIn: () => void
  onSignOut: () => void
  onDeleteAccount: () => Promise<void>
}

/** The sidebar's sign-in button, or the signed-in account and what can be done with it. */
export function AccountControls({ account, onSignIn, onSignOut, onDeleteAccount }: AccountControlsProps) {
  const [deleting, setDeleting] = useState(false)

  if (account === undefined) return null
  if (account === null) {
    return (
      <button type="button" className="button button-outline button-block" onClick={onSignIn}>
        <UserIcon /> Sign in to sync chats
      </button>
    )
  }

  const label = account.email ?? account.name ?? 'Signed in'
  return (
    <>
      <AccountMenu label={label} onSignOut={onSignOut} onDelete={() => setDeleting(true)} />
      {deleting && <DeleteAccountDialog onDelete={onDeleteAccount} onClose={() => setDeleting(false)} />}
    </>
  )
}

/** The signed-in account, which opens a menu to sign out or delete the account. */
function AccountMenu({ label, onSignOut, onDelete }: { label: string; onSignOut: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const step = event.key === 'ArrowDown' ? 1 : -1
    const index = items.indexOf(document.activeElement as HTMLElement)
    items.at((index + step) % items.length)?.focus()
  }

  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div className="account" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
      >
        <span className="account-avatar" aria-hidden="true">
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{label}</span>
      </button>
      {open && (
        <div ref={menu} className="account-menu" role="menu" aria-label="Account" onKeyDown={onKeyDown}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose(onSignOut)}>
            <SignOutIcon /> Sign out
          </button>
          <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => choose(onDelete)}>
            <TrashIcon /> Delete account…
          </button>
        </div>
      )}
    </div>
  )
}

function DeleteAccountDialog({ onDelete, onClose }: { onDelete: () => Promise<void>; onClose: () => void }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setWorking(true)
    setError(null)
    try {
      await onDelete()
    } catch (caught) {
      setError(errorMessage(caught))
      setWorking(false)
    }
  }

  return (
    <Dialog
      title="Delete your account?"
      description="This permanently deletes the account and every chat saved to it. It cannot be undone."
      onClose={onClose}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button button-quiet" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="button" className="button button-danger" onClick={() => void confirm()} disabled={working}>
          {working ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </Dialog>
  )
}
