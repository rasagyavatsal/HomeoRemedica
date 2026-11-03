/** Keep conversation context identical across browser sessions. */

import { type ChatTurn, MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, MAX_TURN_CHARS, contextChars } from './contracts.ts'

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
