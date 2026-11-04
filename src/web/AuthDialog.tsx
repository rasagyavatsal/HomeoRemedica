import { type FormEvent, useState } from 'react'

import { type AuthClient, authErrorMessage } from './auth.ts'
import { Dialog } from './Dialog.tsx'
import { GoogleMark } from './icons.tsx'

type Mode = 'sign-in' | 'sign-up' | 'reset'

const TITLES: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create an account',
  reset: 'Reset your password',
}

export function AuthDialog({ auth, onClose }: { auth: AuthClient; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [working, setWorking] = useState(false)

  async function attempt(action: () => Promise<void>, after: () => void = onClose) {
    setWorking(true)
    setError(null)
    try {
      await action()
      after()
    } catch (caught) {
      setError(authErrorMessage(caught))
    } finally {
      setWorking(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (mode === 'reset') void attempt(() => auth.resetPassword(email.trim()), () => setSent(true))
    else if (mode === 'sign-up') void attempt(() => auth.signUp(email.trim(), password))
    else void attempt(() => auth.signIn(email.trim(), password))
  }

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setSent(false)
  }

  return (
    <Dialog title={TITLES[mode]} onClose={onClose}>
      {mode !== 'reset' && (
        <>
          <button
            type="button"
            className="button button-outline button-block"
            onClick={() => void attempt(() => auth.signInWithGoogle())}
            disabled={working}
          >
            <GoogleMark /> Continue with Google
          </button>
          <p className="dialog-divider">
            <span>or with email</span>
          </p>
        </>
      )}

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-autofocus
          />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'sign-up' ? 6 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <p className="form-success" role="status">
            If an account uses {email.trim()}, a reset link is on its way.
          </p>
        )}

        <button type="submit" className="button button-primary button-block" disabled={working}>
          {mode === 'reset' ? 'Send reset link' : TITLES[mode]}
        </button>
      </form>

      <div className="dialog-links">
        {mode === 'sign-in' && (
          <>
            <button type="button" className="text-button" onClick={() => switchTo('reset')}>
              Forgot password?
            </button>
            <span>
              New here?{' '}
              <button type="button" className="text-button" onClick={() => switchTo('sign-up')}>
                Create an account
              </button>
            </span>
          </>
        )}
        {mode !== 'sign-in' && (
          <span>
            {mode === 'sign-up' ? 'Already have an account? ' : ''}
            <button type="button" className="text-button" onClick={() => switchTo('sign-in')}>
              {mode === 'sign-up' ? 'Sign in' : 'Back to sign in'}
            </button>
          </span>
        )}
      </div>
    </Dialog>
  )
}
