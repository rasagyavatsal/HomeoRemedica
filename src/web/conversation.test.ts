import { describe, expect, it } from 'vitest'

import { type Message, citedSources, contextStart, contextUse, linkCitations, savedMessages, titleFrom } from './conversation.ts'
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
  const messages: Message[] = [
    { id: 0, role: 'user', content: 'Arnica?' },
    { id: 1, role: 'assistant', content: 'Arnica answer.' },
    { id: 2, role: 'user', content: 'Slow?' },
    { id: 3, role: 'assistant', content: 'Partial', status: 'stopped' },
    { id: 4, role: 'user', content: 'Bryonia?' },
    { id: 5, role: 'assistant', content: `Bryonia ${'answer '.repeat(700)}` },
  ]
  const bryonia = [
    { role: 'user' as const, content: 'Bryonia?' },
    { role: 'assistant' as const, content: messages[5]!.content.slice(0, 4_000).trim() },
  ]

  it('measures the history and summary by the nearer limit', () => {
    expect(contextUse({ history: bryonia, summary: 'a'.repeat(4_000) })).toEqual({
      chars: 8_008,
      turns: 2,
      fraction: 8_008 / 16_000,
    })
    const turns = Array.from({ length: 18 }, () => ({ role: 'user' as const, content: 'x' }))
    expect(contextUse({ history: turns }).fraction).toBe(0.9)
  })

  it('finds the first message the history holds, passing over a stopped answer', () => {
    expect(contextStart(messages, bryonia)).toBe(4)
    expect(contextStart(messages, [{ role: 'user', content: 'Arnica?' }, { role: 'assistant', content: 'Arnica answer.' }, ...bryonia])).toBe(0)
    // History that starts with an answer, after the oldest question was dropped.
    expect(contextStart(messages, [{ role: 'assistant', content: 'Arnica answer.' }, ...bryonia])).toBe(1)
  })

  it('has no start for an empty or unmatched history', () => {
    expect(contextStart(messages, [])).toBeUndefined()
    expect(contextStart(messages, [{ role: 'user', content: 'Never asked?' }, ...bryonia])).toBeUndefined()
  })
})
