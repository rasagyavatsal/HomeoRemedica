import { useCallback, useEffect, useRef, useState } from 'react'

import { ShownError, compactChat, errorMessage, streamChat } from './api.ts'
import { type Conversation, type Message, canCompact, newConversation, titleFrom } from './conversation.ts'

export interface ChatControls {
  conversation: Conversation
  busy: boolean
  /** Whether the chat's context is being compacted; no question can be asked meanwhile. */
  compacting: boolean
  ask(question: string): void
  /** Ask the failed question at the end of the chat again. */
  retry(): void
  stop(): void
  /** Condense the chat's earlier turns into a summary; rejects with an error worth showing. */
  compact(): Promise<void>
  /** Show another chat, stopping any answer or compaction in progress. */
  open(conversation: Conversation): void
}

/**
 * The open chat and the request streaming its answer. `onSettled` receives the chat whenever an
 * answer finishes or is stopped, so it can be saved.
 */
export function useChat(onSettled?: (conversation: Conversation) => void): ChatControls {
  const [conversation, setConversation] = useState(newConversation)
  // The latest chat, for request callbacks that outlive the render that started them.
  const latest = useRef(conversation)
  const request = useRef<AbortController | null>(null)
  const compaction = useRef<AbortController | null>(null)
  const [compacting, setCompacting] = useState(false)
  const settled = useRef(onSettled)
  useEffect(() => {
    settled.current = onSettled
  })

  const commit = useCallback((next: Conversation) => {
    latest.current = next
    setConversation(next)
  }, [])

  /** Change the last message of chat `id`, if it is still open. */
  const updateAnswer = useCallback(
    (id: string, change: (answer: Message) => Message, extra?: Partial<Conversation>) => {
      const current = latest.current
      const answer = current.messages.at(-1)
      if (current.id !== id || !answer) return
      commit({ ...current, ...extra, messages: [...current.messages.slice(0, -1), change(answer)] })
    },
    [commit],
  )

  /** Mark the streaming answer stopped and abort its request. */
  const halt = useCallback(() => {
    const controller = request.current
    if (!controller) return
    request.current = null
    controller.abort()
    const current = latest.current
    updateAnswer(current.id, (answer) => ({ ...answer, status: 'stopped' }), { updatedAt: Date.now() })
    settled.current?.(latest.current)
  }, [updateAnswer])

  const ask = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question || request.current || compaction.current) return
      const start = latest.current
      const id = start.id
      const next = (start.messages.at(-1)?.id ?? -1) + 1
      const controller = new AbortController()
      request.current = controller
      commit({
        ...start,
        title: start.title || titleFrom(question),
        messages: [
          ...start.messages,
          { id: next, role: 'user', content: question },
          { id: next + 1, role: 'assistant', content: '', status: 'streaming' },
        ],
      })

      streamChat(
        { message: question, history: start.history, summary: start.summary },
        {
          onSources: (sources) => updateAnswer(id, (answer) => ({ ...answer, sources })),
          onText: (piece) => updateAnswer(id, (answer) => ({ ...answer, content: answer.content + piece })),
        },
        controller.signal,
      ).then(
        (response) => {
          if (request.current !== controller) return
          request.current = null
          updateAnswer(
            id,
            (answer) => ({ id: answer.id, role: 'assistant', content: response.answer, sources: [...response.sources] }),
            { history: response.history, updatedAt: Date.now() },
          )
          settled.current?.(latest.current)
        },
        (error: unknown) => {
          // A stopped request was already marked by `halt`.
          if (request.current !== controller) return
          request.current = null
          updateAnswer(id, (answer) => ({ ...answer, status: 'error', error: errorMessage(error) }))
        },
      )
    },
    [commit, updateAnswer],
  )

  const retry = useCallback(() => {
    const { messages } = latest.current
    const question = messages.at(-2)
    if (request.current || messages.at(-1)?.status !== 'error' || question?.role !== 'user') return
    commit({ ...latest.current, messages: messages.slice(0, -2) })
    ask(question.content)
  }, [ask, commit])

  const compact = useCallback(async () => {
    const start = latest.current
    if (request.current || compaction.current || !canCompact(start.history)) return
    const controller = new AbortController()
    compaction.current = controller
    setCompacting(true)
    try {
      const { summary, history } = await compactChat({ history: start.history, summary: start.summary }, controller.signal)
      if (compaction.current !== controller || latest.current.id !== start.id) return
      commit({ ...latest.current, summary, history })
      settled.current?.(latest.current)
    } catch (error) {
      // Opening another chat abandoned this one's compaction.
      if (compaction.current !== controller) return
      throw new ShownError(`The chat could not be compacted. ${errorMessage(error)}`)
    } finally {
      if (compaction.current === controller) {
        compaction.current = null
        setCompacting(false)
      }
    }
  }, [commit])

  const open = useCallback(
    (next: Conversation) => {
      halt()
      compaction.current?.abort()
      compaction.current = null
      setCompacting(false)
      commit(next)
    },
    [commit, halt],
  )

  // Leaving the page ends the requests.
  useEffect(
    () => () => {
      request.current?.abort()
      const pending = compaction.current
      compaction.current = null
      pending?.abort()
    },
    [],
  )

  const busy = conversation.messages.at(-1)?.status === 'streaming'
  return { conversation, busy, compacting, ask, retry, stop: halt, compact, open }
}
