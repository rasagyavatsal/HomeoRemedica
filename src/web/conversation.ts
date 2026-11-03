/** A chat as the browser holds it, and the helpers that read it. */

import type { ChatTurn, Citation, SavedMessage } from '../server/contracts.ts'

const MAX_TITLE_CHARS = 80
// The server's limits on what the model reads from earlier in a chat.
export const CONTEXT_CHARS = 16_000
export const CONTEXT_TURNS = 20
// The server keeps the latest exchange word for word when it compacts a chat.
const KEPT_TURNS = 2

export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  sources?: Citation[]
  /** Unset once an answer is complete. */
  status?: 'streaming' | 'stopped' | 'error'
  error?: string
}

export interface Conversation {
  id: string
  title: string
  /** When the last answer finished, in milliseconds; 0 for a chat with no answers yet. */
  updatedAt: number
  messages: Message[]
  /** The trimmed history the server returned with the last answer. */
  history: ChatTurn[]
  /** What compacting the chat condensed its earlier turns into. */
  summary?: string
}

export function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: '', updatedAt: 0, messages: [], history: [] }
}

export function titleFrom(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

/** The messages worth keeping: failed questions and their errors are left out. */
export function savedMessages(messages: readonly Message[]): SavedMessage[] {
  const kept: SavedMessage[] = []
  for (const [index, message] of messages.entries()) {
    if (message.status === 'error' || messages[index + 1]?.status === 'error') continue
    const { id, role, content, sources } = message
    kept.push(
      sources
        ? { id, role, content, sources: sources.map((source) => ({ ...source, passageIndexes: [...source.passageIndexes] })) }
        : { id, role, content },
    )
  }
  return kept
}

// `[3]`, `[1, 2]` or `[2-4]`, but not a Markdown link's `[text](url)`.
const CITATION = /\[(\d+(?:\s*[,–-]\s*\d+)*)\](?!\()/g

function citationNumbers(list: string): number[] {
  return list.split(',').flatMap((part) => {
    const [start, end] = part.split(/[–-]/).map((n) => Number.parseInt(n, 10))
    if (start === undefined || Number.isNaN(start)) return []
    if (end === undefined || Number.isNaN(end) || end < start || end - start > 20) return [start]
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  })
}

/** Turn source labels such as `[2]` into `#source-2` links, for sources that exist. */
export function linkCitations(answer: string, sourceCount: number): string {
  return answer.replace(CITATION, (label, list: string) => {
    const numbers = citationNumbers(list).filter((n) => n >= 1 && n <= sourceCount)
    return numbers.length ? numbers.map((n) => `[${n}](#source-${n})`).join('') : label
  })
}

/** The 1-based source numbers an answer cites. */
export function citedSources(answer: string): Set<number> {
  return new Set([...answer.matchAll(CITATION)].flatMap((match) => citationNumbers(match[1] ?? '')))
}

export interface ContextUse {
  chars: number
  turns: number
  /** How full the context is, from 0 to 1, by whichever limit is nearer. */
  fraction: number
}

/** How much of the model's context a chat's history and summary take up. */
export function contextUse({ history, summary }: Pick<Conversation, 'history' | 'summary'>): ContextUse {
  const chars = history.reduce((total, turn) => total + turn.content.length, summary?.length ?? 0)
  const turns = history.length
  return { chars, turns, fraction: Math.min(1, Math.max(chars / CONTEXT_CHARS, turns / CONTEXT_TURNS)) }
}

/** Whether there are turns older than the latest exchange to condense. */
export function canCompact(history: readonly ChatTurn[]): boolean {
  return history.length > KEPT_TURNS
}

/**
 * The index of the first message the model still reads, matching the history to the messages from
 * the end. Stopped and failed answers never reach the history, so they are passed over. Undefined
 * when the history is empty or does not match.
 */
export function contextStart(messages: readonly Message[], history: readonly ChatTurn[]): number | undefined {
  let turn = history.length - 1
  let start: number | undefined
  for (let index = messages.length - 1; index >= 0 && turn >= 0; index--) {
    const message = messages[index]!
    const expected = history[turn]!
    // The history keeps only the start of a long answer.
    const content = message.role === 'assistant' ? message.content.slice(0, expected.content.length).trim() : message.content
    if (message.role !== expected.role || message.status || content !== expected.content) continue
    start = index
    turn--
  }
  return turn < 0 ? start : undefined
}
