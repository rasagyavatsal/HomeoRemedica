import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { ArrowUpIcon, StopIcon } from './icons.tsx'

// The server's limit on one question.
const MAX_QUESTION_CHARS = 4_000
const COUNTER_FROM = MAX_QUESTION_CHARS - 500

export interface ComposerHandle {
  focus(): void
}

interface ComposerProps {
  busy: boolean
  onAsk: (question: string) => void
  onStop: () => void
  ref?: Ref<ComposerHandle>
}

/** The question box: Enter sends, Shift+Enter adds a line. */
export function Composer({ busy, onAsk, onStop, ref }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => field.current?.focus() }), [])

  // Grow with the text, up to the height the stylesheet allows.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft])

  const canSend = draft.trim() !== '' && !busy

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSend) return
    onAsk(draft)
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="question" className="visually-hidden">
        Your question
      </label>
      <textarea
        id="question"
        ref={field}
        className="composer-field"
        rows={1}
        value={draft}
        maxLength={MAX_QUESTION_CHARS}
        placeholder="Ask about a remedy, symptom or principle…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <div className="composer-actions">
        {draft.length >= COUNTER_FROM && (
          <span className="composer-count" aria-live="polite">
            {draft.length.toLocaleString()} / {MAX_QUESTION_CHARS.toLocaleString()}
          </span>
        )}
        {busy ? (
          <button type="button" className="send-button" onClick={onStop} aria-label="Stop answering">
            <StopIcon />
          </button>
        ) : (
          <button type="submit" className="send-button" disabled={!canSend} aria-label="Send question">
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </form>
  )
}
