import { memo, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'

import { Answer } from './Answer.tsx'
import type { AnswerRatings, Citation } from '../server/contracts.ts'
import { type Message, citedSources } from './conversation.ts'
import { AlertIcon, ChevronDownIcon, RetryIcon } from './icons.tsx'
import { AnswerFeedback } from './AnswerFeedback.tsx'
import { CaseReview } from './CaseReview.tsx'
import type { NoteHandler, RateHandler } from './useFeedback.ts'

/** The reference open in the sources panel. */
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
  /** This answer's source open in the sources panel, if any. */
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
          <span className="pulse" aria-hidden="true" />
          {sources ? 'Reading the passages…' : reading ? READING[reading] : 'Searching the books…'}
        </p>
      ) : (
        <Answer content={content} sourceCount={sources?.length ?? 0} onCite={cite} />
      )}
      {status === 'stopped' && <p className="reply-note">{content ? 'Stopped before the answer finished.' : 'Stopped.'}</p>}
      {/* Listed once the answer is done, so the list does not shift while it streams. */}
      {sources && sources.length > 0 && status !== 'streaming' && (
        <References sources={sources} cited={citedSources(content)} active={activeSource} onOpen={cite} />
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
  sources: readonly Citation[]
  cited: ReadonlySet<number>
  active: number | undefined
  onOpen: (number: number) => void
}

/** The passages an answer cites, or every passage it retrieved if it cites none. */
function References({ sources, cited, active, onOpen }: ReferencesProps) {
  const numbered = sources.map((source, index) => ({ source, number: index + 1 }))
  const listed = cited.size ? numbered.filter(({ number }) => cited.has(number)) : numbered
  const labelId = useId()
  return (
    <div className="references">
      <p id={labelId} className="references-label">
        References
      </p>
      <ol className="references-list" aria-labelledby={labelId}>
        {listed.map(({ source, number }) => (
          <li key={source.id}>
            <button
              type="button"
              className="reference"
              data-active={number === active || undefined}
              aria-pressed={number === active}
              onClick={() => onOpen(number)}
            >
              <span className="reference-number">{number}</span>
              <span className="reference-text">
                <span className="reference-heading">{source.remedyName ?? source.sectionTitle}</span>
                <span className="reference-book">{source.bookTitle}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
