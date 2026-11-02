import { useState } from 'react'

import { errorMessage } from './api.ts'
import type { Account } from './auth.ts'
import { Dialog } from './Dialog.tsx'
import { SignOutIcon, UserIcon } from './icons.tsx'

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
      <div className="account">
        <span className="account-avatar" aria-hidden="true">
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name" title={label}>
          {label}
        </span>
        <button type="button" className="icon-button" onClick={onSignOut} aria-label="Sign out" title="Sign out">
          <SignOutIcon />
        </button>
      </div>
      <button type="button" className="text-button text-button-danger" onClick={() => setDeleting(true)}>
        Delete account…
      </button>
      {deleting && <DeleteAccountDialog onDelete={onDeleteAccount} onClose={() => setDeleting(false)} />}
    </>
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
