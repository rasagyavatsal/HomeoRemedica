import { describe, expect, it } from 'vitest'

import { type Message, citedSources, contextFraction, linkCitations, savedMessages, shouldCompact, titleFrom } from './conversation.ts'
import { citation } from './test/fakes.ts'

describe('linkCitations', () => {
  it('links single, listed and ranged labels to sources that exist', () => {
    expect(linkCitations('A [1], B [2, 3] and C [1-2].', 3)).toBe(
      'A [1](#source-1), B [2](#source-2)[3](#source-3) and C [1](#source-1)[2](#source-2).',
    )
  })

  it('leaves labels without a source and Markdown links alone', () => {
    expect(linkCitations('See [9] and [docs](https://example.com) [2](x).', 3)).toBe(
      'See [9] and [docs](https://example.com) [2](x).',
    )
  })
})

it('collects the cited source numbers', () => {
  expect([...citedSources('One [1], two [3–4], again [1].')].sort()).toEqual([1, 3, 4])
})

it('titles a chat with the first line of its question, shortened', () => {
  expect(titleFrom('  What   is\nPulsatilla? ')).toBe('What is Pulsatilla?')
  expect(titleFrom('x'.repeat(100))).toHaveLength(80)
})

it('saves answered and stopped turns but not failed ones', () => {
  const messages: Message[] = [
    { id: 0, role: 'user', content: 'First?' },
    { id: 1, role: 'assistant', content: 'Answer [1].', sources: [citation(1)] },
    { id: 2, role: 'user', content: 'Failed?' },
    { id: 3, role: 'assistant', content: '', status: 'error', error: 'Down.' },
    { id: 4, role: 'user', content: 'Stopped?' },
    { id: 5, role: 'assistant', content: 'Part', status: 'stopped' },
  ]

  expect(savedMessages(messages)).toEqual([
    { id: 0, role: 'user', content: 'First?' },
    { id: 1, role: 'assistant', content: 'Answer [1].', sources: [citation(1)] },
    { id: 4, role: 'user', content: 'Stopped?' },
    { id: 5, role: 'assistant', content: 'Part' },
  ])
})

describe('context', () => {
  const turn = (content: string) => ({ role: 'user' as const, content })

  it('measures the history and summary by the nearer limit', () => {
    expect(contextFraction({ history: [turn('a'.repeat(4_000))], summary: 'a'.repeat(4_000) })).toBe(0.5)
    expect(contextFraction({ history: Array.from({ length: 18 }, () => turn('x')) })).toBe(0.9)
  })

  it('compacts a nearly full chat that has turns before the latest exchange', () => {
    expect(shouldCompact({ history: Array.from({ length: 16 }, () => turn('x')) })).toBe(true)
    expect(shouldCompact({ history: Array.from({ length: 14 }, () => turn('x')) })).toBe(false)
    // Only the latest exchange, which compaction keeps as it is.
    expect(shouldCompact({ history: [turn('a'.repeat(4_000)), turn('a'.repeat(4_000))], summary: 'a'.repeat(4_000) })).toBe(false)
  })
})
