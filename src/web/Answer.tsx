import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import type { Source } from './api'
import { CheckIcon, ChevronIcon, CopyIcon } from './icons'

const CITATION_HREF = '#cite-'
const CODE_SPAN = /(```[\s\S]*?```|`[^`\n]*`)/
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\](?![(:[])/g

/** Replace each `[1]` or `[1, 2]` label outside code whose numbers all name a source. */
function replaceCitations(markdown: string, sourceCount: number, replace: (numbers: number[]) => string): string {
  return markdown.split(CODE_SPAN).map((part, index) => index % 2 ? part : part.replace(CITATION, (label, list: string) => {
    const numbers = list.split(',').map((value) => Number(value.trim()))
    if (!numbers.every((value) => value >= 1 && value <= sourceCount)) return label
    return replace(numbers)
  })).join('')
}

/** Turn `[1]` and `[1, 2]` labels into citation links, leaving code and unknown numbers untouched. */
export function linkCitations(markdown: string, sourceCount: number): string {
  return replaceCitations(markdown, sourceCount, (numbers) => numbers.map((value) => `[${value}](${CITATION_HREF}${value})`).join(''))
}

export function citedNumbers(markdown: string, sourceCount: number): ReadonlySet<number> {
  const cited = new Set<number>()
  replaceCitations(markdown, sourceCount, (numbers) => {
    numbers.forEach((value) => cited.add(value))
    return ''
  })
  return cited
}

/** The remedy, or the section for passages about principles rather than a remedy. */
function sourceLabel(source: Source): string {
  return source.remedyName ?? source.sectionTitle
}

function Sources({ sources, cited, open, onOpenChange, openItems, onItemChange, highlighted, itemId }: {
  sources: readonly Source[]
  cited: ReadonlySet<number>
  open: boolean
  onOpenChange: (open: boolean) => void
  openItems: ReadonlySet<number>
  onItemChange: (number: number, open: boolean) => void
  highlighted: number | null
  itemId: (number: number) => string
}) {
  // Sources the answer cites come first; the rest were retrieved but not used.
  const numbers = sources.map((_, index) => index + 1)
    .sort((a, b) => Number(cited.has(b)) - Number(cited.has(a)) || a - b)
  return (
    <details className="sources" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>
        <span className="sources-chevron"><ChevronIcon /></span>Sources
        <span className="sources-count">{sources.length}</span>
      </summary>
      <ol className="source-list">
        {numbers.map((number) => {
          const source = sources[number - 1]!
          const uncited = cited.size > 0 && !cited.has(number)
          const className = [highlighted === number && 'source-highlighted', uncited && 'source-uncited'].filter(Boolean).join(' ')
          return (
            <li key={source.id} id={itemId(number)} className={className || undefined}>
              <details className="source" open={openItems.has(number)} onToggle={(event) => onItemChange(number, event.currentTarget.open)}>
                <summary>
                  <span className="source-number">{number}</span>
                  <span className="source-heading">
                    <span className="source-remedy">{sourceLabel(source)}{source.remedyName && source.sectionTitle && <span className="source-section"> · {source.sectionTitle}</span>}</span>
                    <span className="source-book">{source.bookTitle}{source.author && <span className="source-author"> — {source.author}</span>}</span>
                  </span>
                  {uncited && <span className="source-tag">Not cited</span>}
                  <span className="source-chevron"><ChevronIcon /></span>
                </summary>
                <div className="source-content">
                  <p className="source-text">{source.text}</p>
                  <code className="source-id">{source.id}</code>
                </div>
              </details>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard access can be denied; the answer stays selectable.
    }
  }

  return (
    <button className="icon-button" type="button" onClick={() => void copy()} aria-label={copied ? 'Copied' : 'Copy answer'} title={copied ? 'Copied' : 'Copy answer'}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

export function Answer({ id, content, sources }: { id: number; content: string; sources: readonly Source[] }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [openItems, setOpenItems] = useState<ReadonlySet<number>>(new Set())
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const itemId = (number: number) => `source-${id}-${number}`

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  function setItemOpen(number: number, open: boolean) {
    setOpenItems((current) => {
      if (current.has(number) === open) return current
      const updated = new Set(current)
      if (open) updated.add(number)
      else updated.delete(number)
      return updated
    })
  }

  function showSource(number: number) {
    setSourcesOpen(true)
    setItemOpen(number, true)
    setHighlighted(number)
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlighted(null), 1800)
    requestAnimationFrame(() => document.getElementById(itemId(number))?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }))
  }

  const components: Components = {
    a({ href, children }) {
      if (href?.startsWith(CITATION_HREF)) {
        const number = Number(href.slice(CITATION_HREF.length))
        const source = sources[number - 1]
        return (
          <button type="button" className="citation" onClick={() => showSource(number)} aria-label={`Source ${number}: ${source ? `${sourceLabel(source)}, ${source.bookTitle}` : ''}`} title={source ? `${sourceLabel(source)} — ${source.bookTitle}` : undefined}>
            {children}
          </button>
        )
      }
      return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    },
  }

  return (
    <>
      <div className="answer">
        <ReactMarkdown skipHtml components={components}>{linkCitations(content, sources.length)}</ReactMarkdown>
      </div>
      <div className="answer-footer">
        {sources.length > 0 && (
          <Sources sources={sources} cited={citedNumbers(content, sources.length)} open={sourcesOpen} onOpenChange={setSourcesOpen} openItems={openItems} onItemChange={setItemOpen} highlighted={highlighted} itemId={itemId} />
        )}
        <div className="answer-actions"><CopyButton text={content} /></div>
      </div>
    </>
  )
}
