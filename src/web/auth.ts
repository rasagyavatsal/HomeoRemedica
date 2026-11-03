/** Sign-in through Firebase Authentication, loaded only when the server has accounts. */

import type { AuthConfig } from '../server/contracts.ts'
import { ShownError } from './api.ts'

export interface Account {
  uid: string
  email: string | null
  name: string | null
  /** Chats sync only once the email address is verified; Google sign-ins always are. */
  verified: boolean
}

export interface AuthClient {
  /** Calls `listener` with the signed-in account, or null, now and after every change. */
  subscribe(listener: (account: Account | null) => void): () => void
  /** A current ID token for the API. */
  token(): Promise<string>
  signIn(email: string, password: string): Promise<void>
  /** Create the account and send its email verification link. */
  signUp(email: string, password: string): Promise<void>
  signInWithGoogle(): Promise<void>
  /** Send the signed-in account another email verification link. */
  sendVerification(): Promise<void>
  /** Check whether the email address has been verified since sign-in, perhaps in another tab. */
  refresh(): Promise<void>
  resetPassword(email: string): Promise<void>
  signOut(): Promise<void>
}

export async function connectAuth({ emulator, ...config }: AuthConfig): Promise<AuthClient> {
  const [{ initializeApp }, firebase] = await Promise.all([import('firebase/app'), import('firebase/auth')])
  const auth = firebase.getAuth(initializeApp(config))
  if (emulator) firebase.connectAuthEmulator(auth, emulator, { disableWarnings: true })
  auth.useDeviceLanguage()

  return {
    // ID token changes include sign-in, sign-out, and the refresh after an email is verified.
    subscribe: (listener) =>
      firebase.onIdTokenChanged(auth, (user) =>
        listener(user && { uid: user.uid, email: user.email, name: user.displayName, verified: user.emailVerified }),
      ),
    async token() {
      const user = auth.currentUser
      if (!user) throw new ShownError('Please sign in again.')
      return user.getIdToken()
    },
    async signIn(email, password) {
      await firebase.signInWithEmailAndPassword(auth, email, password)
    },
    async signUp(email, password) {
      const { user } = await firebase.createUserWithEmailAndPassword(auth, email, password)
      // The account exists either way; a link that fails to send can be sent again from the menu.
      await firebase.sendEmailVerification(user).catch(() => {})
    },
    async signInWithGoogle() {
      await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider())
    },
    async sendVerification() {
      const user = auth.currentUser
      if (!user) throw new ShownError('Please sign in again.')
      await firebase.sendEmailVerification(user)
    },
    async refresh() {
      const user = auth.currentUser
      if (!user || user.emailVerified) return
      // Fetch a new ID token first: reload() tells subscribers the email is verified, and the
      // API calls they start must already carry the verified claim.
      await user.getIdToken(true)
      await user.reload()
    },
    resetPassword: (email) => firebase.sendPasswordResetEmail(auth, email),
    signOut: () => firebase.signOut(auth),
  }
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/user-not-found': 'The email or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Choose a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'The sign-in service could not be reached. Check your connection.',
  'auth/popup-blocked': 'Allow pop-ups for this site to sign in with Google.',
  'auth/operation-not-allowed': 'This way of signing in is not available.',
  'auth/user-disabled': 'This account has been disabled.',
}

// Closing the Google pop-up is a choice, not a failure.
const SILENT_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])

/** A message for a failed sign-in, or null when there is nothing to report. */
export function authErrorMessage(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (SILENT_CODES.has(code)) return null
  if (error instanceof ShownError) return error.message
  return AUTH_MESSAGES[code] ?? 'Signing in failed. Please try again.'
}
