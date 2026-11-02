import Markdown, { type Components } from 'react-markdown'

import type { Citation } from '../server/contracts.ts'
import { CloseIcon } from './icons.tsx'

interface SourcesPanelProps {
  source: Citation
  /** The source's number in its answer, from 1. */
  number: number
  onClose: () => void
}

// Passages are Markdown from the source books; links and images are not part of them.
const passageComponents: Components = {
  a: ({ children }) => <>{children}</>,
  img: () => null,
}

/** The passage behind one reference in an answer. */
export function SourcesPanel({ source, number, onClose }: SourcesPanelProps) {
  const heading = source.remedyName ?? source.sectionTitle
  return (
    <section className="sources" aria-labelledby="sources-title">
      <header className="sources-header">
        <div className="source-meta">
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
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close source">
          <CloseIcon />
        </button>
      </header>
      <div className="sources-body">
        <div className="source-text">
          <Markdown components={passageComponents}>{source.text}</Markdown>
        </div>
      </div>
    </section>
  )
}
