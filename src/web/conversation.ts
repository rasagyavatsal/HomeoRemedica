/** A chat as the browser holds it, and the helpers that read it. */

import type { ChatTurn, Citation, SavedMessage } from '../server/contracts.ts'

const MAX_TITLE_CHARS = 80
export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  sources?: Citation[]
  /** Unset once an answer is complete; `review` while the user checks the case's symptoms and diseases. */
  status?: 'streaming' | 'review' | 'stopped' | 'error'
  /** What a streaming answer waits on before the books are searched: the question being sorted, or its case read for symptoms and diseases. */
  reading?: 'question' | 'case'
  /** The symptoms read from the case: under review, then as the user confirmed them until the answer is complete. */
  symptoms?: string[]
  /** The diseases read from the case, kept as the symptoms are; unset when they could not be read. */
  diseases?: string[]
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
  /** What the server condensed the chat's earlier turns into, returned with an answer. */
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
