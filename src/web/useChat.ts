import { useCallback, useEffect, useRef, useState } from 'react'

import { type ChatQuestion, errorMessage, readKind, readSymptoms, streamChat } from './api.ts'
import { type Conversation, type Message, newConversation, titleFrom } from './conversation.ts'

export interface ChatControls {
  conversation: Conversation
  busy: boolean
  ask(question: string): void
  /** Ask the failed question at the end of the chat again. */
  retry(): void
  /** Answer the question under review by these symptoms. */
  confirm(symptoms: string[]): void
  stop(): void
  /** Show another chat, stopping any answer in progress. */
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
    const current = latest.current
    // A question whose symptoms are under review has no request to abort.
    if (!controller && current.messages.at(-1)?.status !== 'review') return
    request.current = null
    controller?.abort()
    updateAnswer(current.id, (answer) => ({ ...answer, status: 'stopped' }), { updatedAt: Date.now() })
    settled.current?.(latest.current)
  }, [updateAnswer])

  /** Stream the answer to `question` into the last message of chat `id`. */
  const answer = useCallback(
    async (id: string, question: ChatQuestion, controller: AbortController) => {
      try {
        const response = await streamChat(
          question,
          {
            onSources: (sources) => updateAnswer(id, (answer) => ({ ...answer, sources })),
            onText: (piece) => updateAnswer(id, (answer) => ({ ...answer, content: answer.content + piece })),
          },
          controller.signal,
        )
        if (request.current !== controller) return
        request.current = null
        updateAnswer(
          id,
          (answer) => ({ id: answer.id, role: 'assistant', content: response.answer, sources: [...response.sources] }),
          { history: response.history, summary: response.summary, updatedAt: Date.now() },
        )
        settled.current?.(latest.current)
      } catch (error) {
        // A stopped request was already marked by `halt`.
        if (request.current !== controller) return
        request.current = null
        updateAnswer(id, (answer) => ({ ...answer, status: 'error', error: errorMessage(error) }))
      }
    },
    [updateAnswer],
  )

  const ask = useCallback(
    (text: string) => {
      const question = text.trim()
      if (!question || request.current) return
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
          { id: next + 1, role: 'assistant', content: '', status: 'streaming', reading: 'question' },
        ],
      })

      void (async () => {
        const asked = { message: question, history: start.history, summary: start.summary }
        // Left unset, the question is answered by the symptoms the server reads.
        let symptoms: string[] | undefined
        try {
          if ((await readKind(asked, controller.signal)) === 'case') {
            if (request.current !== controller) return
            updateAnswer(id, (answer) => ({ ...answer, reading: 'case' }))
            symptoms = await readSymptoms(asked, controller.signal)
          } else {
            symptoms = []
          }
        } catch {
          // Without the symptoms to check, the question is still answered.
        }
        if (request.current !== controller) return
        if (symptoms?.length) {
          const found = symptoms
          request.current = null
          updateAnswer(id, ({ reading: _read, ...answer }) => ({ ...answer, status: 'review', symptoms: found }))
          return
        }
        updateAnswer(id, ({ reading: _read, ...answer }) => answer)
        await answer(id, { ...asked, symptoms }, controller)
      })()
    },
    [answer, commit, updateAnswer],
  )

  const confirm = useCallback(
    (symptoms: string[]) => {
      const { id, messages, history, summary } = latest.current
      const question = messages.at(-2)
      if (request.current || messages.at(-1)?.status !== 'review' || question?.role !== 'user') return
      const controller = new AbortController()
      request.current = controller
      // Kept with the answer until it is complete, so a failed one is asked again by the same symptoms.
      updateAnswer(id, (answer) => ({ ...answer, status: 'streaming', symptoms }))
      void answer(id, { message: question.content, history, summary, symptoms }, controller)
    },
    [answer, updateAnswer],
  )

  const retry = useCallback(() => {
    const { id, messages, history, summary } = latest.current
    const question = messages.at(-2)
    const failed = messages.at(-1)
    if (request.current || failed?.status !== 'error' || question?.role !== 'user') return
    const { symptoms } = failed
    if (symptoms) {
      // The user already confirmed the case's symptoms; they are not read or reviewed again.
      const controller = new AbortController()
      request.current = controller
      updateAnswer(id, (answer) => ({ id: answer.id, role: 'assistant', content: '', status: 'streaming', symptoms }))
      void answer(id, { message: question.content, history, summary, symptoms }, controller)
      return
    }
    commit({ ...latest.current, messages: messages.slice(0, -2) })
    ask(question.content)
  }, [answer, ask, commit, updateAnswer])

  const open = useCallback(
    (next: Conversation) => {
      halt()
      commit(next)
    },
    [commit, halt],
  )

  // Leaving the page ends the requests.
  useEffect(
    () => () => request.current?.abort(),
    [],
  )

  const status = conversation.messages.at(-1)?.status
  const busy = status === 'streaming' || status === 'review'
  return { conversation, busy, ask, retry, confirm, stop: halt, open }
}
