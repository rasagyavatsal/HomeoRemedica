import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { type AccountClient, accountErrorMessage } from './account'
import { CloseIcon } from './icons'

type Mode = 'sign-in' | 'sign-up' | 'reset'

const TITLES: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create an account',
  reset: 'Reset your password',
}

const SUBMIT_LABELS: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  reset: 'Send reset link',
}

interface AuthDialogProps {
  client: AccountClient
  onClose: () => void
}

export function AuthDialog({ client, onClose }: AuthDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function switchMode(next: Mode) {
    setMode(next)
    setPassword('')
    setError('')
    setNotice('')
  }

  /** Run a sign-in step; the app closes the dialog once the user changes. */
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (failure) {
      setError(accountErrorMessage(failure) ?? '')
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const address = email.trim()
    if (mode === 'reset') {
      void run(async () => {
        await client.resetPassword(address)
        // The same message whether or not an account exists, so the form cannot reveal accounts.
        setNotice('If an account uses this email, a link to reset its password is on its way.')
      })
    } else {
      void run(() => (mode === 'sign-in' ? client.signIn(address, password) : client.signUp(address, password)))
    }
  }

  return (
    <dialog ref={dialog} className="auth-dialog" aria-labelledby="auth-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="auth-head">
        <h2 id="auth-title">{TITLES[mode]}</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
      </div>
      <p className="auth-lede">Save your chats to an account and open them on any device.</p>

      {mode !== 'reset' && (
        <>
          <button className="button auth-google" type="button" onClick={() => void run(() => client.signInWithGoogle())} disabled={busy}>
            Continue with Google
          </button>
          <div className="auth-divider" aria-hidden="true"><span>or</span></div>
        </>
      )}

      <form className="auth-form" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              minLength={mode === 'sign-up' ? 6 : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <button className="button primary auth-submit" type="submit" disabled={busy}>{SUBMIT_LABELS[mode]}</button>
      </form>

      <p className="auth-switch">
        {mode === 'sign-in' && (
          <>
            New here? <button className="text-button" type="button" onClick={() => switchMode('sign-up')}>Create an account</button>
            <span aria-hidden="true"> · </span>
            <button className="text-button" type="button" onClick={() => switchMode('reset')}>Forgot password?</button>
          </>
        )}
        {mode === 'sign-up' && (
          <>Already have an account? <button className="text-button" type="button" onClick={() => switchMode('sign-in')}>Sign in</button></>
        )}
        {mode === 'reset' && <button className="text-button" type="button" onClick={() => switchMode('sign-in')}>Back to sign in</button>}
      </p>
      <p className="auth-privacy">
        Chats saved to an account are stored with Google Cloud in Mumbai, India. You can delete them, or the whole account, at any time.
      </p>
    </dialog>
  )
}
