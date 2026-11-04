import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

import { type Conversation, canCompact, contextUse } from './conversation.ts'

// The ring's radius in a 20-unit box, and the share of the context from which it shows a warning.
const RADIUS = 8
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const NEARLY_FULL = 0.8

interface ContextMeterProps {
  conversation: Pick<Conversation, 'history' | 'summary'>
  compacting: boolean
  /** Whether an answer is streaming, which holds back compacting. */
  busy: boolean
  onCompact: () => void
}

/** A ring showing how full the model's context is, which opens the percentage and a Compact button. */
export function ContextMeter({ conversation, compacting, busy, onCompact }: ContextMeterProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const { fraction } = contextUse(conversation)
  const percent = Math.round(fraction * 100)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || !open) return
    // Keep Escape from also closing the sources panel or the drawer.
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <div className="context" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="icon-button context-meter"
        data-level={fraction >= NEARLY_FULL ? 'high' : undefined}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`Context ${percent}% full`}
      >
        <svg className="context-ring" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle className="context-ring-track" cx="10" cy="10" r={RADIUS} />
          <circle
            className="context-ring-fill"
            cx="10"
            cy="10"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        </svg>
      </button>
      {open && (
        <div id={popoverId} className="context-popover" role="dialog" aria-label="Context">
          <p className="context-percent">{percent}% of context used</p>
          <button
            type="button"
            className="button button-outline button-small button-block"
            onClick={onCompact}
            disabled={busy || compacting || !canCompact(conversation.history)}
          >
            {compacting ? 'Compacting…' : 'Compact'}
          </button>
        </div>
      )}
    </div>
  )
}
