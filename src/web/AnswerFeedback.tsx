import { type CSSProperties, type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { AnswerRatings, FeedbackReason, Rating } from '../server/contracts.ts'
import { ArrowUpIcon, CheckIcon } from './icons.tsx'
import { RatingButtons } from './Rating.tsx'
import type { AnswerNote } from './useFeedback.ts'

// The server's limit.
const MAX_COMMENT_CHARS = 1_000

const REASONS: Record<FeedbackReason, string> = {
  wrong_remedy: 'Wrong remedy',
  irrelevant_sources: 'Irrelevant sources',
  missing_information: 'Missing information',
  unclear: 'Unclear',
}

const UNRATED: AnswerRatings = { answer: null, sources: {}, reasons: [], comment: null }

interface AnswerFeedbackProps {
  ratings: AnswerRatings | undefined
  onRate: (rating: Rating | null) => void
  /** Resolves with whether the note was saved. */
  onNote: (note: AnswerNote) => Promise<boolean>
}

/**
 * Thumbs for an answer. Choosing one opens a box for a comment, with reasons to pick when the
 * answer was rated down; choosing it again while the box is open takes the rating back.
 */
export function AnswerFeedback({ ratings = UNRATED, onRate, onNote }: AnswerFeedbackProps) {
  const { answer: rating, reasons, comment } = ratings
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  // Counts comments sent, so each one plays its check afresh.
  const [sent, setSent] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  // A rating undone because it could not be saved closes the box too.
  const shown = open && rating !== null

  const choose = (next: Rating | null) => {
    if (next === null) {
      setOpen(false)
      onRate(null)
      return
    }
    if (next !== rating) onRate(next)
    if (!shown) {
      setDraft(comment ?? '')
      setSent(0)
    }
    setOpen(true)
  }

  useEffect(() => {
    if (shown) field.current?.focus()
  }, [shown])

  // Grow with the text, up to the height the stylesheet allows.
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft, shown])

  // A click elsewhere closes a box with nothing typed in it.
  useEffect(() => {
    if (!shown) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !field.current?.value.trim()) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [shown])

  const toggleReason = (reason: FeedbackReason) => {
    void onNote({ reasons: reasons.includes(reason) ? reasons.filter((r) => r !== reason) : [...reasons, reason] })
  }

  const changed = draft.trim() !== (comment ?? '')

  function submit(event?: FormEvent) {
    event?.preventDefault()
    setOpen(false)
    if (!changed) return
    setSent((count) => count + 1)
    // Reopen with the text still there if it could not be saved.
    onNote({ comment: draft }).then((saved) => saved || setOpen(true))
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="answer-feedback" ref={root}>
      <div className="answer-feedback-bar">
        <RatingButtons
          rating={rating}
          onRate={choose}
          label="Rate this answer"
          up="Helpful"
          down="Not helpful"
          clears={shown}
        />
        {sent > 0 && !shown && (
          <span key={sent} className="feedback-sent" aria-hidden="true">
            <CheckIcon />
          </span>
        )}
      </div>
      {/* Kept in the page while closed, so it can slide shut. */}
      <div className="feedback-panel" data-open={shown || undefined} inert={!shown} aria-hidden={!shown || undefined}>
        <div className="feedback-panel-inner">
          {rating === 'down' && (
            <div className="feedback-reasons" role="group" aria-label="What went wrong">
              {(Object.keys(REASONS) as FeedbackReason[]).map((reason, index) => (
                <button
                  key={reason}
                  type="button"
                  className="feedback-reason"
                  style={{ '--chip': index } as CSSProperties}
                  aria-pressed={reasons.includes(reason)}
                  onClick={() => toggleReason(reason)}
                >
                  {REASONS[reason]}
                </button>
              ))}
            </div>
          )}
          <form className="feedback-form" onSubmit={submit}>
            <textarea
              ref={field}
              className="feedback-field"
              rows={1}
              value={draft}
              maxLength={MAX_COMMENT_CHARS}
              aria-label="Comment"
              placeholder={rating === 'down' ? 'What was missing or wrong?' : 'What helped?'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="feedback-send" disabled={!changed} aria-label="Send comment">
              <ArrowUpIcon />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
