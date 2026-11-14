import { memo, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'

import { Answer } from './Answer.tsx'
import type { AnswerRatings } from '../server/contracts.ts'
import { type Message, listedSources } from './conversation.ts'
import { AlertIcon, ChevronDownIcon, ChevronRightIcon, DropMark, RetryIcon } from './icons.tsx'
import { AnswerFeedback } from './AnswerFeedback.tsx'
import { CaseReview } from './CaseReview.tsx'
import type { NoteHandler, RateHandler } from './useFeedback.ts'

/** What the sources panel shows: one of an answer's references, or the list of them as source 0. */
interface OpenReference {
  messageId: number
  source: number
}

interface ThreadProps {
  messages: readonly Message[]
  /** The reference open in the sources panel, if any. */
  openSources: OpenReference | undefined
  onSources: (messageId: number, source: number) => void
  onRetry: () => void
  /** Answers the question whose case is under review by the symptoms and diseases given. */
  onConfirm: (symptoms: string[], diseases?: string[]) => void
  /** Ratings by message id. */
  ratings?: ReadonlyMap<number, AnswerRatings>
  /** Rates an answer or one of its sources; answers cannot be rated without it. */
  onRate?: RateHandler | undefined
  onNote?: NoteHandler | undefined
}

export function Thread({ messages, openSources, onSources, onRetry, onConfirm, ratings, onRate, onNote }: ThreadProps) {
  return (
    <ol className="thread" aria-label="Conversation">
      {messages.map((message, index) =>
        message.role === 'user' ? (
          <li key={message.id} className="question">
            <Question content={message.content} />
          </li>
        ) : (
          <li key={message.id} className="reply">
            <Reply
              message={message}
              activeSource={openSources?.messageId === message.id ? openSources.source : undefined}
              onSources={onSources}
              onRetry={index === messages.length - 1 ? onRetry : undefined}
              onConfirm={index === messages.length - 1 ? onConfirm : undefined}
              ratings={ratings?.get(message.id)}
              onRate={onRate}
              onNote={onNote}
            />
          </li>
        ),
      )}
    </ol>
  )
}

/** A question; one too long for the fold opens and closes on a click. */
function Question({ content }: { content: string }) {
  const text = useRef<HTMLHeadingElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  const id = useId()

  // Measured while folded: the question is long when the fold hides some of it.
  useLayoutEffect(() => {
    const node = text.current
    if (!node || open) return
    const measure = () => setLong(node.scrollHeight > node.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [content, open])

  const toggle = () => setOpen((value) => !value)

  return (
    <div
      className="question-bubble"
      data-long={long || undefined}
      data-open={open || undefined}
      onClick={
        long
          ? (event) => {
              // Selecting text in the question is not a request to fold it.
              const selection = getSelection()
              if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return
              toggle()
            }
          : undefined
      }
    >
      <h2 id={id} ref={text} className="question-text">
        {content}
      </h2>
      {long && (
        <button
          type="button"
          className="question-toggle"
          aria-expanded={open}
          aria-controls={id}
          aria-label={open ? 'Collapse question' : 'Expand question'}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
        >
          <ChevronDownIcon />
        </button>
      )}
    </div>
  )
}

/** What a waiting answer says before the books are searched. */
const READING = { question: 'Reading your question…', case: 'Reading the case for symptoms and diseases…' } as const

interface ReplyProps {
  message: Message
  /** This answer's source open in the sources panel, if any; 0 while the list of its references is. */
  activeSource: number | undefined
  onSources: (messageId: number, source: number) => void
  onRetry: (() => void) | undefined
  onConfirm: ((symptoms: string[], diseases?: string[]) => void) | undefined
  ratings: AnswerRatings | undefined
  onRate: RateHandler | undefined
  onNote: NoteHandler | undefined
}

const Reply = memo(function Reply({ message, activeSource, onSources, onRetry, onConfirm, ratings, onRate, onNote }: ReplyProps) {
  const { id, content, sources, status, reading } = message
  const cite = useCallback((number: number) => onSources(id, number), [id, onSources])

  if (status === 'error') {
    return (
      <div className="reply-error" role="alert">
        <AlertIcon />
        <p>{message.error}</p>
        {onRetry && (
          <button type="button" className="button button-quiet" onClick={onRetry}>
            <RetryIcon /> Try again
          </button>
        )}
      </div>
    )
  }

  if (status === 'review' && onConfirm) return <CaseReview symptoms={message.symptoms ?? []} diseases={message.diseases} onConfirm={onConfirm} />

  const waiting = status === 'streaming' && !content
  return (
    <>
      {waiting ? (
        <p className="reply-progress" role="status">
          <DropMark className="tap-drop" />
          {sources ? 'Reading the passages…' : reading ? READING[reading] : 'Searching the books…'}
        </p>
      ) : (
        <Answer content={content} sourceCount={sources?.length ?? 0} onCite={cite} />
      )}
      {status === 'stopped' && <p className="reply-note">{content ? 'Stopped before the answer finished.' : 'Stopped.'}</p>}
      {/* Listed once the answer is done, so the list does not shift while it streams. */}
      {sources && sources.length > 0 && status !== 'streaming' && (
        <References numbers={listedSources(content, sources.length)} open={activeSource === 0} onOpen={() => cite(0)} />
      )}
      {onRate && onNote && !status && content && (
        <div className="reply-actions">
          <AnswerFeedback
            ratings={ratings}
            onRate={(rating) => onRate(id, 'answer', rating)}
            onNote={(note) => onNote(id, note)}
          />
        </div>
      )}
    </>
  )
})

interface ReferencesProps {
  /** The numbers of the sources the answer lists, from 1. */
  numbers: readonly number[]
  /** Whether the list of them is open in the sources panel. */
  open: boolean
  onOpen: () => void
}

/** One row under an answer that opens the list of its references in the sources panel. */
function References({ numbers, open, onOpen }: ReferencesProps) {
  return (
    <button type="button" className="references" aria-pressed={open} onClick={onOpen}>
      <span className="references-stack" aria-hidden="true">
        {numbers.slice(0, 3).map((number) => (
          <span key={number} className="reference-number">
            {number}
          </span>
        ))}
      </span>
      {numbers.length === 1 ? '1 reference' : `${numbers.length} references`}
      <ChevronRightIcon />
    </button>
  )
}
