/** Keep conversation context identical across browser sessions. */

import { type ChatTurn, KEPT_TURNS, MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, MAX_TURN_CHARS, contextChars } from './contracts.ts'

// How full the context may get before a chat is compacted, leaving room for the next exchange so
// that `advanceHistory` does not drop the earliest turns instead.
const COMPACT_FROM = 0.8

/** Whether to condense a chat's earlier turns before answering its next question. */
export function shouldCompact({ history, summary }: { history: readonly ChatTurn[]; summary?: string | undefined }): boolean {
  const full = Math.max(contextChars(history, summary) / MAX_HISTORY_CHARS, history.length / MAX_HISTORY_TURNS)
  // Only turns older than the latest exchange can be condensed.
  return history.length > KEPT_TURNS && full >= COMPACT_FROM
}

/** The history after an answer; a compacted chat's summary counts against the same limit. */
export function advanceHistory(history: readonly ChatTurn[], message: string, answer: string, summary?: string): ChatTurn[] {
  const turns: ChatTurn[] = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: answer.slice(0, MAX_TURN_CHARS).trim() },
  ]
  let recent = turns.slice(-MAX_HISTORY_TURNS)
  while (contextChars(recent, summary) > MAX_HISTORY_CHARS) {
    recent = recent.slice(1)
  }
  return recent
}
