import { useEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'

import type { Citation } from '../server/contracts.ts'
import { CloseIcon } from './icons.tsx'

interface SourcesPanelProps {
  sources: readonly Citation[]
  cited: ReadonlySet<number>
  /** The source to bring into view, numbered from 1. */
  active: number | undefined
  onClose: () => void
}

/** The passages behind one answer: the cited ones first, then the rest it retrieved. */
export function SourcesPanel({ sources, cited, active, onClose }: SourcesPanelProps) {
  const numbered = sources.map((source, index) => ({ source, number: index + 1 }))
  const used = numbered.filter(({ number }) => cited.has(number))
  const unused = numbered.filter(({ number }) => !cited.has(number))
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active === undefined) return
    const card = list.current?.querySelector<HTMLElement>(`[data-source="${active}"]`)
    card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    card?.focus({ preventScroll: true })
  }, [active, sources])

  return (
    <section className="sources" aria-labelledby="sources-title">
      <header className="sources-header">
        <div>
          <h2 id="sources-title">Sources</h2>
          <p className="sources-summary">
            {cited.size ? `${used.length} cited of ${sources.length} retrieved` : `${sources.length} retrieved`}
          </p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close sources">
          <CloseIcon />
        </button>
      </header>
      <div className="sources-list" ref={list}>
        {used.map(({ source, number }) => (
          <SourceCard key={source.id} source={source} number={number} active={number === active} />
        ))}
        {unused.length > 0 && used.length > 0 && <h3 className="sources-divider">Retrieved but not cited</h3>}
        {unused.map(({ source, number }) => (
          <SourceCard key={source.id} source={source} number={number} active={number === active} muted={used.length > 0} />
        ))}
      </div>
    </section>
  )
}

// Passages longer than this start clamped; the stylesheet sets the clamped height.
const PREVIEW_CHARS = 420

// Passages are Markdown from the source books; links and images are not part of them.
const passageComponents: Components = {
  a: ({ children }) => <>{children}</>,
  img: () => null,
}

function SourceCard({ source, number, active, muted }: { source: Citation; number: number; active: boolean; muted?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const long = source.text.length > PREVIEW_CHARS
  const heading = source.remedyName ?? source.sectionTitle

  return (
    <article
      className="source-card"
      data-source={number}
      data-active={active || undefined}
      data-muted={muted || undefined}
      tabIndex={-1}
      aria-label={`Source ${number}: ${heading}`}
    >
      <div className="source-meta">
        <span className="source-number">{number}</span>
        <div>
          <h3 className="source-heading">{heading}</h3>
          <p className="source-book">
            {source.bookTitle}
            {source.remedyName && source.sectionTitle && <> · {source.sectionTitle}</>}
          </p>
        </div>
      </div>
      <div className="source-text" data-clamped={(long && !expanded) || undefined}>
        <Markdown components={passageComponents}>{source.text}</Markdown>
      </div>
      {long && (
        <button type="button" className="text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show full passage'}
        </button>
      )}
    </article>
  )
}
