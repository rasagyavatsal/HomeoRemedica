import { describe, expect, it, vi } from 'vitest'

import { ApiError, errorMessage, readEvents, streamChat } from './api.ts'
import { chatResponse, citation, eventStream, json, sse } from './test/fakes.ts'

async function collect(chunks: string[]) {
  const events = []
  for await (const event of readEvents(eventStream(chunks))) events.push(event)
  return events
}

describe('readEvents', () => {
  it('parses events split across chunks and line endings', async () => {
    expect(await collect(['event: text\r', '\ndata: {"text":"a"}\r\n\r\nevent: done\nda', 'ta: 1\n\n'])).toEqual([
      { event: 'text', data: '{"text":"a"}' },
      { event: 'done', data: '1' },
    ])
  })

  it('joins multi-line data, skips comments and reads a final unterminated event', async () => {
    expect(await collect([': keep-alive\n\ndata: one\ndata: two\n\nevent: last\ndata: x'])).toEqual([
      { event: 'message', data: 'one\ntwo' },
      { event: 'last', data: 'x' },
    ])
  })
})

describe('streamChat', () => {
  it('reports sources and text, then resolves with the complete response', async () => {
    const sources = [citation(1)]
    const done = chatResponse('Answer [1].', sources)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(eventStream([sse('sources', sources), sse('text', { text: 'Answer ' }), sse('text', { text: '[1].' }), sse('done', done)])),
    )
    const onSources = vi.fn()
    const onText = vi.fn()

    await expect(streamChat({ message: 'Q?', history: [] }, { onSources, onText })).resolves.toEqual(done)

    expect(onSources).toHaveBeenCalledWith(sources)
    expect(onText.mock.calls).toEqual([['Answer '], ['[1].']])
    const [, init] = fetch.mock.calls[0]!
    expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream')
    expect(JSON.parse(init?.body as string)).toEqual({ message: 'Q?', history: [] })
  })

  it('rejects with the detail of an error event', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(eventStream([sse('error', { detail: 'Provider down.' })])))

    await expect(streamChat({ message: 'Q?', history: [] })).rejects.toThrow('Provider down.')
  })

  it('rejects with the detail of a failed request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ detail: 'Too many questions.' }, 429))

    const error = await streamChat({ message: 'Q?', history: [] }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'Too many questions.', status: 429 })
  })

  it('rejects when the stream ends without an answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(eventStream([sse('text', { text: 'Half' })])))

    await expect(streamChat({ message: 'Q?', history: [] })).rejects.toThrow('stopped before it finished')
  })
})

it('describes network failures and unknown errors safely', () => {
  expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/could not be reached/)
  expect(errorMessage(new Error('secret stack'))).toBe('Something went wrong. Please try again.')
})
