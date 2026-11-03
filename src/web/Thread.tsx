import { memo, useCallback, useId } from 'react'

import { Answer } from './Answer.tsx'
import type { AnswerRatings, Citation } from '../server/contracts.ts'
import { type Message, citedSources } from './conversation.ts'
import { AlertIcon, RetryIcon } from './icons.tsx'
import { RatingButtons } from './Rating.tsx'
import type { RateHandler } from './useFeedback.ts'

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
  /** Ratings by message id. */
  ratings?: ReadonlyMap<number, AnswerRatings>
  /** Rates an answer or one of its sources; answers cannot be rated without it. */
  onRate?: RateHandler | undefined
}

export function Thread({ messages, openSources, onSources, onRetry, ratings, onRate }: ThreadProps) {
  return (
    <ol className="thread" aria-label="Conversation">
      {messages.map((message, index) =>
        message.role === 'user' ? (
          <li key={message.id} className="question">
            <h2 className="question-text">{message.content}</h2>
          </li>
        ) : (
          <li key={message.id} className="reply">
            <Reply
              message={message}
              activeSource={openSources?.messageId === message.id ? openSources.source : undefined}
              onSources={onSources}
              onRetry={index === messages.length - 1 ? onRetry : undefined}
              ratings={ratings?.get(message.id)}
              onRate={onRate}
            />
          </li>
        ),
      )}
    </ol>
  )
}

interface ReplyProps {
  message: Message
  /** This answer's source open in the sources panel, if any. */
  activeSource: number | undefined
  onSources: (messageId: number, source: number) => void
  onRetry: (() => void) | undefined
  ratings: AnswerRatings | undefined
  onRate: RateHandler | undefined
}

const Reply = memo(function Reply({ message, activeSource, onSources, onRetry, ratings, onRate }: ReplyProps) {
  const { id, content, sources, status } = message
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

  const waiting = status === 'streaming' && !content
  return (
    <>
      {waiting ? (
        <p className="reply-progress" role="status">
          <span className="pulse" aria-hidden="true" />
          {sources ? 'Reading the passages…' : 'Searching the books…'}
        </p>
      ) : (
        <Answer content={content} sourceCount={sources?.length ?? 0} onCite={cite} />
      )}
      {status === 'stopped' && <p className="reply-note">{content ? 'Stopped before the answer finished.' : 'Stopped.'}</p>}
      {/* Listed once the answer is done, so the list does not shift while it streams. */}
      {sources && sources.length > 0 && status !== 'streaming' && (
        <References sources={sources} cited={citedSources(content)} active={activeSource} onOpen={cite} />
      )}
      {onRate && !status && content && (
        <div className="reply-actions">
          <RatingButtons
            rating={ratings?.answer ?? null}
            onRate={(rating) => onRate(id, 'answer', rating)}
            label="Rate this answer"
            up="Helpful"
            down="Not helpful"
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
