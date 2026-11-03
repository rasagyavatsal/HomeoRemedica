import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AnswerRatings, Feedback, FeedbackReason, Rating } from '../server/contracts.ts'
import { errorMessage } from './api.ts'
import { type Conversation, type Message, citedSources } from './conversation.ts'

/** Where ratings are saved, and loaded from when a chat opens. */
export interface FeedbackClient {
  rate(id: string, feedback: Feedback): Promise<void>
  /** The ratings saved for a chat's answers, by message id. */
  ratings(chatId: string): Promise<Record<number, AnswerRatings>>
}

/** The answer itself, or one of its sources by number. */
export type RateTarget = 'answer' | number

export type RateHandler = (messageId: number, target: RateTarget, rating: Rating | null) => void

/** Why an answer was rated as it was; omitted parts stay as they are. */
export interface AnswerNote {
  reasons?: FeedbackReason[]
  comment?: string | null
}

/** Resolves with whether the note was saved. */
export type NoteHandler = (messageId: number, note: AnswerNote) => Promise<boolean>

const UNRATED: AnswerRatings = { answer: null, sources: {}, reasons: [], comment: null }

/** The id every rating of an answer is saved under. */
export function feedbackId(chatId: string, messageId: number): string {
  return `${chatId}-${messageId}`
}

/** What the server keeps for an answer, or undefined while the answer cannot be rated. */
export function feedbackFor(messages: readonly Message[], messageId: number, ratings: AnswerRatings): Feedback | undefined {
  const index = messages.findIndex((message) => message.id === messageId)
  const answer = messages[index]
  const question = messages[index - 1]
  if (answer?.role !== 'assistant' || answer.status || !answer.content || question?.role !== 'user') return undefined
  const cited = citedSources(answer.content)
  return {
    question: question.content,
    answer: answer.content,
    rating: ratings.answer,
    sources: (answer.sources ?? []).map((source, index) => ({
      id: source.id,
      cited: cited.has(index + 1),
      rating: ratings.sources[index + 1] ?? null,
    })),
    reasons: ratings.reasons,
    comment: ratings.comment,
  }
}

function rated(ratings: AnswerRatings, target: RateTarget, rating: Rating | null): AnswerRatings {
  // Reasons say what was wrong, so they go when the answer is no longer rated down.
  if (target === 'answer') return { ...ratings, answer: rating, reasons: rating === 'down' ? ratings.reasons : [] }
  const { [target]: _, ...sources } = ratings.sources
  return { ...ratings, sources: rating ? { ...sources, [target]: rating } : sources }
}

function same(a: AnswerRatings, b: AnswerRatings): boolean {
  const numbers = new Set([...Object.keys(a.sources), ...Object.keys(b.sources)].map(Number))
  return (
    a.answer === b.answer &&
    a.comment === b.comment &&
    a.reasons.join() === b.reasons.join() &&
    [...numbers].every((number) => a.sources[number] === b.sources[number])
  )
}

export interface FeedbackControls {
  /** The open chat's ratings, by message id. */
  ratings: ReadonlyMap<number, AnswerRatings>
  rate: RateHandler
  note: NoteHandler
}

/**
 * Ratings of the open chat's answers, loaded when the chat opens and saved as they change. A
 * rating shows at once and is undone if it cannot be saved.
 */
export function useFeedback(
  conversation: Conversation,
  /** Null where ratings cannot be saved, such as without a verified account. */
  client: FeedbackClient | null,
  onError: (message: string) => void,
): FeedbackControls {
  const [all, setAll] = useState<ReadonlyMap<string, AnswerRatings>>(() => new Map())
  // The newest ratings, which each request sends, and the ones the server has.
  const latest = useRef(all)
  const saved = useRef(new Map<string, AnswerRatings>())
  const queues = useRef(new Map<string, Promise<boolean>>())
  // Chats whose saved ratings were loaded, or are loading.
  const loaded = useRef(new Set<string>())
  const chat = useRef(conversation)
  useEffect(() => {
    chat.current = conversation
  })

  // A chat opened with answers may have saved ratings; a new chat has none. Ratings given while
  // they load win over the loaded ones.
  useEffect(() => {
    const chatId = conversation.id
    if (!client || !chat.current.messages.length || loaded.current.has(chatId)) return
    loaded.current.add(chatId)
    client.ratings(chatId).then(
      (ratings) => {
        const next = new Map(latest.current)
        for (const [messageId, answer] of Object.entries(ratings)) {
          const id = feedbackId(chatId, Number(messageId))
          if (next.has(id)) continue
          next.set(id, answer)
          saved.current.set(id, answer)
        }
        latest.current = next
        setAll(next)
      },
      // Try again the next time the chat opens.
      () => loaded.current.delete(chatId),
    )
  }, [client, conversation.id])

  const show = useCallback((id: string, ratings: AnswerRatings) => {
    const next = new Map(latest.current).set(id, ratings)
    latest.current = next
    setAll(next)
  }, [])

  /** Change an answer's ratings; resolves with whether the change was saved. */
  const update = useCallback(
    async (messageId: number, change: (ratings: AnswerRatings) => AnswerRatings): Promise<boolean> => {
      if (!client) return false
      const { id: chatId, messages } = chat.current
      const id = feedbackId(chatId, messageId)
      const next = change(latest.current.get(id) ?? UNRATED)
      if (!feedbackFor(messages, messageId, next)) return false
      show(id, next)
      // One request at a time per answer, each sending the newest ratings, so they arrive in order.
      const request = (queues.current.get(id) ?? Promise.resolve(true)).then(async () => {
        const ratings = latest.current.get(id) ?? UNRATED
        if (same(ratings, saved.current.get(id) ?? UNRATED)) return true
        try {
          await client.rate(id, feedbackFor(messages, messageId, ratings)!)
          saved.current.set(id, ratings)
          return true
        } catch (error) {
          show(id, saved.current.get(id) ?? UNRATED)
          onError(`Your feedback could not be saved. ${errorMessage(error)}`)
          return false
        }
      })
      queues.current.set(id, request)
      return request
    },
    [client, onError, show],
  )

  const rate = useCallback<RateHandler>(
    (messageId, target, rating) => void update(messageId, (ratings) => rated(ratings, target, rating)),
    [update],
  )

  const note = useCallback<NoteHandler>(
    (messageId, { reasons, comment }) =>
      update(messageId, (ratings) => ({
        ...ratings,
        reasons: reasons ?? ratings.reasons,
        comment: comment === undefined ? ratings.comment : comment?.trim() || null,
      })),
    [update],
  )

  const ratings = useMemo(() => {
    const prefix = `${conversation.id}-`
    const open = new Map<number, AnswerRatings>()
    for (const [id, answer] of all) {
      if (id.startsWith(prefix)) open.set(Number(id.slice(prefix.length)), answer)
    }
    return open
  }, [all, conversation.id])

  return { ratings, rate, note }
}
