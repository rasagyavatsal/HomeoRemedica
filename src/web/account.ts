/** Sign-in through Firebase Authentication. The SDK loads only when the server offers accounts. */

import type { User as FirebaseUser } from 'firebase/auth'
import type { AuthConfig } from '../server/contracts.ts'

export interface User {
  id: string
  email: string
}

export interface AccountClient {
  /** Called once the saved sign-in is restored (or not), and again on every change. */
  onUserChanged(listener: (user: User | null) => void): () => void
  /** A current ID token for the API, refreshed when it is about to expire. */
  idToken(): Promise<string>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<void>
  signInWithGoogle(): Promise<void>
  resetPassword(email: string): Promise<void>
  signOut(): Promise<void>
}

export async function loadAccountClient(config: AuthConfig): Promise<AccountClient> {
  const [{ getApps, initializeApp }, firebase] = await Promise.all([import('firebase/app'), import('firebase/auth')])
  // Development renders twice, and Firebase allows one default app.
  const auth = firebase.getAuth(getApps()[0] ?? initializeApp(config))
  const user = (value: FirebaseUser | null): User | null => value && { id: value.uid, email: value.email ?? '' }
  return {
    onUserChanged: (listener) => firebase.onAuthStateChanged(auth, (value) => listener(user(value))),
    async idToken() {
      if (!auth.currentUser) throw new Error('Please sign in again.')
      return auth.currentUser.getIdToken()
    },
    async signIn(email, password) {
      await firebase.signInWithEmailAndPassword(auth, email, password)
    },
    async signUp(email, password) {
      await firebase.createUserWithEmailAndPassword(auth, email, password)
    },
    async signInWithGoogle() {
      await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider())
    },
    async resetPassword(email) {
      await firebase.sendPasswordResetEmail(auth, email)
    },
    signOut: () => firebase.signOut(auth),
  }
}

// Null means the person cancelled, so there is nothing to show.
const MESSAGES: Record<string, string | null> = {
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/user-not-found': 'The email or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'An account already uses this email. Sign in instead.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'The sign-in service could not be reached. Check your connection and try again.',
  'auth/popup-blocked': 'Allow pop-ups for this site to continue with Google.',
  'auth/account-exists-with-different-credential': 'This email already signs in another way. Use your password instead.',
  'auth/popup-closed-by-user': null,
  'auth/cancelled-popup-request': null,
}

export function accountErrorMessage(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return code in MESSAGES ? (MESSAGES[code] ?? null) : 'Sign-in failed. Please try again.'
}
