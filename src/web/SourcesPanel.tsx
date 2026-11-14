import type { Components } from 'react-markdown'

import type { Citation, Rating } from '../server/contracts.ts'
import { ArrowLeftIcon, CloseIcon } from './icons.tsx'
import { Markdown } from './Markdown.tsx'
import { RatingButtons } from './Rating.tsx'

interface SourcesPanelProps {
  source: Citation
  /** The source's number in its answer, from 1. */
  number: number
  onClose: () => void
  /** Goes back to the list of the answer's references; there is no way back without this. */
  onBack?: (() => void) | undefined
  /** Puts focus on the way back, when the passage was opened from the list. */
  focusBack?: boolean
  rating?: Rating | null
  /** Rates the passage; it cannot be rated without this. */
  onRate?: ((rating: Rating | null) => void) | undefined
}

// Passages are Markdown from the source books; links and images are not part of them.
const passageComponents: Components = {
  a: ({ children }) => <>{children}</>,
  img: () => null,
}

/** The passage behind one reference in an answer. */
export function SourcesPanel({ source, number, onClose, onBack, focusBack = false, rating = null, onRate }: SourcesPanelProps) {
  const heading = source.remedyName ?? source.sectionTitle
  return (
    <section className="sources" aria-labelledby="sources-title">
      <header className="sources-header">
        <div className="source-meta">
          {onBack && (
            <button type="button" className="icon-button" onClick={onBack} aria-label="All references" autoFocus={focusBack}>
              <ArrowLeftIcon />
            </button>
          )}
          <span className="source-number">{number}</span>
          <div>
            <h2 id="sources-title" className="source-heading">
              {heading}
            </h2>
            <p className="source-book">
              {source.bookTitle}
              {source.remedyName && source.sectionTitle && <> · {source.sectionTitle}</>}
            </p>
          </div>
        </div>
        <div className="sources-actions">
          {onRate && (
            <RatingButtons rating={rating} onRate={onRate} label="Rate this passage" up="Relevant" down="Not relevant" />
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close source">
            <CloseIcon />
          </button>
        </div>
      </header>
      <div className="sources-body">
        <div className="source-text">
          <Markdown components={passageComponents}>{source.text}</Markdown>
        </div>
      </div>
    </section>
  )
}

interface ReferencesPanelProps {
  sources: readonly Citation[]
  /** The numbers of the sources the answer lists, from 1. */
  numbers: readonly number[]
  onOpen: (number: number) => void
  onClose: () => void
  /** The reference to put focus on, when coming back from its passage. */
  focused?: number | undefined
}

/** The references an answer lists, each opening its passage. */
export function ReferencesPanel({ sources, numbers, onOpen, onClose, focused }: ReferencesPanelProps) {
  return (
    <section className="sources" aria-labelledby="sources-title">
      <header className="sources-header sources-header-centred">
        <h2 id="sources-title" className="source-heading">
          References
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close references">
          <CloseIcon />
        </button>
      </header>
      <ol className="sources-body reference-list" aria-labelledby="sources-title">
        {numbers.map((number) => {
          const source = sources[number - 1]
          if (!source) return null
          return (
            <li key={source.id}>
              <button type="button" className="reference" onClick={() => onOpen(number)} autoFocus={number === focused}>
                <span className="reference-number">{number}</span>
                <span className="reference-text">
                  <span className="reference-heading">{source.remedyName ?? source.sectionTitle}</span>
                  <span className="reference-book">{source.bookTitle}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
