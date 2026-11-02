import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Composer, type ComposerHandle } from './Composer.tsx'
import { citedSources } from './conversation.ts'
import { LeafMark } from './icons.tsx'
import { SourcesPanel } from './SourcesPanel.tsx'
import { Thread } from './Thread.tsx'
import { useChat } from './useChat.ts'
import { Welcome } from './Welcome.tsx'

/** Which answer's sources are open, and the source to show. */
interface OpenSources {
  messageId: number
  source?: number
}

export default function App() {
  const chat = useChat()
  const { conversation } = chat
  const [openSources, setOpenSources] = useState<OpenSources | null>(null)
  const composer = useRef<ComposerHandle>(null)
  const scroller = useFollow(conversation.messages)

  const showSources = useCallback((messageId: number, source?: number) => {
    setOpenSources((open) =>
      source === undefined && open?.messageId === messageId && open.source === undefined ? null : { messageId, source },
    )
  }, [])
  const closeSources = useCallback(() => setOpenSources(null), [])

  const ask = useCallback(
    (question: string) => {
      chat.ask(question)
      composer.current?.focus()
    },
    [chat.ask],
  )

  const sourcesFor = openSources && conversation.messages.find((message) => message.id === openSources.messageId)

  useEffect(() => {
    if (!openSources) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpenSources(null)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSources])

  return (
    <div className="app" data-sources={sourcesFor?.sources ? 'open' : undefined}>
      <main className="main">
        <header className="topbar">
          <div className="brand">
            <LeafMark />
            <span className="brand-name">HomeoRemedica</span>
          </div>
          {conversation.title && <p className="topbar-title">{conversation.title}</p>}
        </header>

        <div className="scroller" ref={scroller}>
          <div className="reading">
            {conversation.messages.length ? (
              <Thread
                messages={conversation.messages}
                openSources={openSources?.messageId}
                onSources={showSources}
                onRetry={chat.retry}
              />
            ) : (
              <Welcome onAsk={ask} />
            )}
          </div>
        </div>

        <footer className="composer-area">
          <div className="reading">
            <Composer ref={composer} busy={chat.busy} onAsk={chat.ask} onStop={chat.stop} />
            <p className="disclaimer">Historical reference only — not medical advice. For symptoms, see a qualified practitioner.</p>
          </div>
        </footer>
      </main>

      {sourcesFor?.sources && (
        <>
          <div className="scrim scrim-sources" onClick={closeSources} aria-hidden="true" />
          <SourcesPanel
            sources={sourcesFor.sources}
            cited={citedSources(sourcesFor.content)}
            active={openSources?.source}
            onClose={closeSources}
          />
        </>
      )}
    </div>
  )
}

/**
 * Keep a scroll container at its end as messages stream in, unless the reader has scrolled up.
 * A new question always scrolls to the end.
 */
function useFollow(messages: readonly unknown[]) {
  const element = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const count = useRef(messages.length)

  useEffect(() => {
    const node = element.current
    if (!node) return
    const onScroll = () => {
      atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const node = element.current
    const added = messages.length > count.current
    count.current = messages.length
    if (node && (atEnd.current || added)) node.scrollTop = node.scrollHeight
  }, [messages])

  return element
}
