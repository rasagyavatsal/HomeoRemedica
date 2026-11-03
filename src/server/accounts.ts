/** Signed-in users, the chats saved to their accounts and their ratings of answers, kept in Firebase. */

import { type App, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldPath, FieldValue, type Firestore, getFirestore } from 'firebase-admin/firestore'

import type { AuthConfig, ChatSummary, Feedback, SavedChat, SavedConversation, SavedMessage, SavedRatings } from './contracts.ts'

/** The most recent chats `list` returns. */
export const MAX_LISTED_CHATS = 200

export interface ChatStore {
  /** The user's chats, newest first. */
  list(userId: string): Promise<ChatSummary[]>
  get(userId: string, chatId: string): Promise<SavedConversation | null>
  /** Save the whole chat; resolves with how many messages had to be written. */
  put(userId: string, chatId: string, chat: SavedChat): Promise<number>
  delete(userId: string, chatId: string): Promise<void>
  deleteAll(userId: string): Promise<void>
}

/** Feedback for message `messageId` of chat `chatId` is saved as `${chatId}-${messageId}`. */
export interface FeedbackStore {
  /** Save the user's ratings of one answer, replacing any saved before. */
  put(userId: string, feedbackId: string, feedback: Feedback): Promise<void>
  /** The ratings the user saved for a chat's answers, by message id. */
  list(userId: string, chatId: string): Promise<Map<number, SavedRatings>>
}

export interface User {
  id: string
  /** Whether the user has shown they own their email address; Google sign-ins always have. */
  verified: boolean
}

export interface Accounts {
  readonly config: AuthConfig
  readonly chats: ChatStore
  readonly feedback: FeedbackStore
  /** The user a Firebase ID token belongs to, or undefined when it is invalid or expired. */
  user(idToken: string): Promise<User | undefined>
  /** Remove the sign-in itself; delete the user's chats first. */
  deleteUser(userId: string): Promise<void>
}

export function firebaseAccounts(config: AuthConfig): Accounts {
  const app = initializeApp({ projectId: config.projectId }, `accounts-${config.projectId}`)
  const auth = getAuth(app)
  // One instance for both stores: `firestore` applies settings, which may only happen once.
  const db = firestore(app)
  return {
    config,
    chats: new FirestoreChatStore(db),
    feedback: new FirestoreFeedbackStore(db),
    async user(idToken) {
      try {
        const token = await auth.verifyIdToken(idToken)
        return { id: token.uid, verified: token.email_verified === true }
      } catch (error) {
        // A bad or expired token means "sign in again"; anything else is a server problem.
        if (isAuthError(error)) return undefined
        throw error
      }
    },
    async deleteUser(userId) {
      try {
        await auth.deleteUser(userId)
      } catch (error) {
        if (!(isAuthError(error) && error.code === 'auth/user-not-found')) throw error
      }
    },
  }
}

function firestore(app: App): Firestore {
  const db = getFirestore(app)
  db.settings({ ignoreUndefinedProperties: true })
  return db
}

function isAuthError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' && error.code.startsWith('auth/') && error.code !== 'auth/internal-error'
}

/**
 * Chats under `users/{userId}/chats/{chatId}`, each message in its own document so a long chat
 * stays under Firestore's document size limit. Messages are only appended, so a save writes
 * just the ones the stored chat does not have yet.
 */
export class FirestoreChatStore implements ChatStore {
  readonly #db: Firestore

  constructor(db: Firestore) {
    this.#db = db
  }

  #chats(userId: string) {
    return this.#db.collection('users').doc(userId).collection('chats')
  }

  async list(userId: string): Promise<ChatSummary[]> {
    const snapshot = await this.#chats(userId)
      .orderBy('updatedAt', 'desc')
      .limit(MAX_LISTED_CHATS)
      .select('title', 'updatedAt')
      .get()
    return snapshot.docs.map((doc) => ({ id: doc.id, title: doc.get('title'), updatedAt: doc.get('updatedAt') }))
  }

  async get(userId: string, chatId: string): Promise<SavedConversation | null> {
    const chat = this.#chats(userId).doc(chatId)
    const [summary, messages] = await Promise.all([
      chat.get(),
      chat.collection('messages').orderBy(FieldPath.documentId()).get(),
    ])
    if (!summary.exists) return null
    return { messages: messages.docs.map((doc) => doc.data() as SavedMessage), history: summary.get('history') }
  }

  async put(userId: string, chatId: string, { title, updatedAt, messages, history }: SavedChat): Promise<number> {
    const chat = this.#chats(userId).doc(chatId)
    const message = (index: number) => chat.collection('messages').doc(String(index).padStart(4, '0'))
    return this.#db.runTransaction(async (transaction) => {
      const stored: number = (await transaction.get(chat)).get('messageCount') ?? 0
      for (let index = stored; index < messages.length; index++) transaction.set(message(index), messages[index]!)
      for (let index = messages.length; index < stored; index++) transaction.delete(message(index))
      transaction.set(chat, { title, updatedAt, history, messageCount: messages.length })
      return Math.max(0, messages.length - stored)
    })
  }

  async delete(userId: string, chatId: string): Promise<void> {
    await this.#db.recursiveDelete(this.#chats(userId).doc(chatId))
  }

  async deleteAll(userId: string): Promise<void> {
    await this.#db.recursiveDelete(this.#db.collection('users').doc(userId))
  }
}

/**
 * Ratings under `users/{userId}/feedback/{feedbackId}`, one document per answer. They sit beside
 * the user's chats, so `FirestoreChatStore.deleteAll` deletes them with the account.
 */
export class FirestoreFeedbackStore implements FeedbackStore {
  readonly #db: Firestore

  constructor(db: Firestore) {
    this.#db = db
  }

  #feedback(userId: string) {
    return this.#db.collection('users').doc(userId).collection('feedback')
  }

  async put(userId: string, feedbackId: string, feedback: Feedback): Promise<void> {
    await this.#feedback(userId).doc(feedbackId).set({ ...feedback, updatedAt: FieldValue.serverTimestamp() })
  }

  async list(userId: string, chatId: string): Promise<Map<number, SavedRatings>> {
    // Every id from `${chatId}-` up to it followed by the highest character; the long question
    // and answer stay behind.
    const prefix = `${chatId}-`
    const snapshot = await this.#feedback(userId)
      .orderBy(FieldPath.documentId())
      .startAt(prefix)
      .endAt(`${prefix}\uf8ff`)
      .select('rating', 'sources', 'reasons', 'comment')
      .get()
    const ratings = new Map<number, SavedRatings>()
    for (const doc of snapshot.docs) {
      // Another chat's id may begin with this one's, but its message part is not a number.
      const messageId = doc.id.slice(prefix.length)
      if (!/^\d+$/.test(messageId)) continue
      // Ratings saved before reasons and comments existed have neither.
      ratings.set(Number(messageId), {
        rating: doc.get('rating'),
        sources: doc.get('sources'),
        reasons: doc.get('reasons') ?? [],
        comment: doc.get('comment') ?? null,
      })
    }
    return ratings
  }
}
