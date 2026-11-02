import { createContext, memo, useContext, useMemo } from 'react'
import Markdown, { type Components } from 'react-markdown'

import { linkCitations } from './conversation.ts'

/** Opens source `number` of the answer being rendered. */
const CiteContext = createContext<(number: number) => void>(() => {})

// Defined once, so streamed updates re-render citation buttons instead of remounting them.
const components: Components = {
  a({ href, children }) {
    const number = href?.match(/^#source-(\d+)$/)?.[1]
    if (number) return <CitationButton number={Number(number)} />
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
  img: () => null,
}

function CitationButton({ number }: { number: number }) {
  const cite = useContext(CiteContext)
  return (
    <button type="button" className="citation" onClick={() => cite(number)} aria-label={`Source ${number}`}>
      {number}
    </button>
  )
}

interface AnswerProps {
  content: string
  sourceCount: number
  onCite: (number: number) => void
}

/** An answer's Markdown, with source labels such as `[2]` as buttons. */
export const Answer = memo(function Answer({ content, sourceCount, onCite }: AnswerProps) {
  const markdown = useMemo(() => linkCitations(content, sourceCount), [content, sourceCount])
  return (
    <CiteContext.Provider value={onCite}>
      <div className="prose">
        <Markdown components={components}>{markdown}</Markdown>
      </div>
    </CiteContext.Provider>
  )
})
