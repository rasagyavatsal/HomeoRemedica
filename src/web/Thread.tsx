import { memo, useCallback } from 'react'

import { Answer } from './Answer.tsx'
import { type Message, citedSources } from './conversation.ts'
import { AlertIcon, BookIcon, RetryIcon } from './icons.tsx'

interface ThreadProps {
  messages: readonly Message[]
  /** The answer whose sources are open, if any. */
  openSources: number | undefined
  onSources: (messageId: number, source?: number) => void
  onRetry: () => void
}

export function Thread({ messages, openSources, onSources, onRetry }: ThreadProps) {
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
              sourcesOpen={openSources === message.id}
              onSources={onSources}
              onRetry={index === messages.length - 1 ? onRetry : undefined}
            />
          </li>
        ),
      )}
    </ol>
  )
}

interface ReplyProps {
  message: Message
  sourcesOpen: boolean
  onSources: (messageId: number, source?: number) => void
  onRetry: (() => void) | undefined
}

const Reply = memo(function Reply({ message, sourcesOpen, onSources, onRetry }: ReplyProps) {
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
  const cited = citedSources(content)
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
      {sources && sources.length > 0 && (
        <button
          type="button"
          className="sources-toggle"
          data-open={sourcesOpen || undefined}
          aria-expanded={sourcesOpen}
          onClick={() => onSources(id)}
        >
          <BookIcon />
          {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          {cited.size > 0 && (
            <>
              {' '}
              <span className="sources-toggle-detail">· {cited.size} cited</span>
            </>
          )}
        </button>
      )}
    </>
  )
})
