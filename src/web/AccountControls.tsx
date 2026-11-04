import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { errorMessage } from './api.ts'
import type { Account } from './auth.ts'
import { Dialog } from './Dialog.tsx'
import { DocumentIcon, MailIcon, ShieldIcon, SignInIcon, SignOutIcon, TrashIcon, UserIcon } from './icons.tsx'

interface AccountControlsProps {
  /** The signed-in account, null when signed out, or undefined while that is unknown. */
  account: Account | null | undefined
  /** Absent when the server has no accounts. */
  onSignIn: (() => void) | undefined
  onSignOut: () => void
  onResendVerification: () => void
  onDeleteAccount: () => Promise<void>
}

/** The sidebar's profile: a guest, or the signed-in account, with a menu of what can be done. */
export function AccountControls({ account, onSignIn, onSignOut, onResendVerification, onDeleteAccount }: AccountControlsProps) {
  const [deleting, setDeleting] = useState(false)

  if (account === undefined) return null
  if (account === null) {
    return (
      <AccountMenu label="Guest" avatar={<UserIcon />} guest>
        {onSignIn && (
          <>
            <div role="separator" className="menu-separator" />
            <button type="button" role="menuitem" className="menu-item" onClick={onSignIn}>
              <SignInIcon /> Sign in
            </button>
          </>
        )}
      </AccountMenu>
    )
  }

  const label = account.email ?? account.name ?? 'Signed in'
  return (
    <>
      <AccountMenu label={label} avatar={label.slice(0, 1).toUpperCase()}>
        <div role="separator" className="menu-separator" />
        {!account.verified && (
          <button type="button" role="menuitem" className="menu-item" onClick={onResendVerification}>
            <MailIcon /> Resend verification email
          </button>
        )}
        <button type="button" role="menuitem" className="menu-item" onClick={onSignOut}>
          <SignOutIcon /> Sign out
        </button>
        <button type="button" role="menuitem" className="menu-item menu-item-danger" onClick={() => setDeleting(true)}>
          <TrashIcon /> Delete account…
        </button>
      </AccountMenu>
      {deleting && <DeleteAccountDialog onDelete={onDeleteAccount} onClose={() => setDeleting(false)} />}
    </>
  )
}

/** The profile, which opens a menu of the legal pages followed by the given account actions. */
function AccountMenu({
  label,
  avatar,
  guest = false,
  children,
}: {
  label: string
  avatar: ReactNode
  guest?: boolean
  children: ReactNode
}) {
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
        <span className="account-avatar" data-guest={guest || undefined} aria-hidden="true">
          {avatar}
        </span>
        <span className="account-name">{label}</span>
      </button>
      {open && (
        // Choosing any item closes the menu.
        <div
          ref={menu}
          className="account-menu"
          role="menu"
          aria-label="Account"
          onKeyDown={onKeyDown}
          onClick={(event) => (event.target as HTMLElement).closest('[role="menuitem"]') && setOpen(false)}
        >
          <a href="/terms" target="_blank" rel="noopener" role="menuitem" className="menu-item">
            <DocumentIcon /> Terms of Use
          </a>
          <a href="/privacy" target="_blank" rel="noopener" role="menuitem" className="menu-item">
            <ShieldIcon /> Privacy Policy
          </a>
          {children}
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
