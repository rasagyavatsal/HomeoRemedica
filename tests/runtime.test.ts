import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadCorpus, loadSettings } from '../src/server/runtime.ts'
import { ConfigurationError, ProviderError, ProviderTimeoutError, TokenExhaustionError } from '../src/server/errors.ts'
import { DEFAULT_ZAI_BASE_URL, ZaiChatClient } from '../src/server/generation.ts'
import { fakeFetch, json, sse, stream, timeout } from './fakes.ts'

describe('settings', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'homeoremedica-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('defaults to GLM flash and reads provider keys', () => {
    const settings = loadSettings(
      { ZAI_API_KEY: 'zai-key', QDRANT_URL: 'https://qdrant.example', QDRANT_API_KEY: 'qdrant-key' },
      directory,
    )

    expect(settings).toEqual({
      qdrantUrl: 'https://qdrant.example',
      qdrantApiKey: 'qdrant-key',
      qdrantCollection: 'materia_medica',
      model: 'glm-5.3-flash',
      maxOutputTokens: 4_096,
      zaiApiKey: 'zai-key',
      openrouterApiKey: undefined,
    })
  })

  it('prefers the environment, then .env.local, then .env', () => {
    writeFileSync(join(directory, '.env'), 'RAG_MODEL=from-env-file\nZAI_API_KEY=file-key\nQDRANT_URL=\n')
    writeFileSync(join(directory, '.env.local'), 'export RAG_MODEL="from-local"\nRAG_MAX_OUTPUT_TOKENS=1024\n')

    const settings = loadSettings({ ZAI_API_KEY: 'env-key' }, directory)

    expect(settings.model).toBe('from-local')
    expect(settings.maxOutputTokens).toBe(1_024)
    expect(settings.zaiApiKey).toBe('env-key')
    expect(settings.qdrantUrl).toBeUndefined()
  })

  it.each(['0', '4097', 'many', '12.5'])('rejects RAG_MAX_OUTPUT_TOKENS=%s', (value) => {
    expect(() => loadSettings({ RAG_MAX_OUTPUT_TOKENS: value }, directory)).toThrow(ConfigurationError)
  })

  it('requires a Qdrant URL to load the corpus', () => {
    expect(() => loadCorpus(loadSettings({}, directory))).toThrow(/QDRANT_URL/)
  })
})

describe('Z.AI chat client', () => {
  const client = (fetch: ReturnType<typeof fakeFetch>) =>
    new ZaiChatClient({ apiKey: 'zai-key', model: 'glm-5.3-flash', maxOutputTokens: 4_096, fetch })

  const delta = (content: string, extra: Record<string, unknown> = {}) => ({ choices: [{ delta: { content }, ...extra }] })

  it('streams an OpenAI-compatible chat request', async () => {
    const fetch = fakeFetch(
      sse({ choices: [{ delta: { reasoning_content: 'Thinking.' } }] }, delta('Grounded '), delta('answer.', { finish_reason: 'stop' })),
    )
    const pieces: string[] = []

    const answer = await client(fetch).generate('Retrieved evidence', {
      systemInstruction: 'Use citations.',
      onText: (text) => pieces.push(text),
    })

    expect(answer).toBe('Grounded answer.')
    expect(pieces).toEqual(['Grounded ', 'answer.'])
    expect(fetch.calls).toEqual([
      {
        url: `${DEFAULT_ZAI_BASE_URL}/chat/completions`,
        method: 'POST',
        headers: { Authorization: 'Bearer zai-key', 'Content-Type': 'application/json' },
        body: {
          model: 'glm-5.3-flash',
          messages: [
            { role: 'system', content: 'Use citations.' },
            { role: 'user', content: 'Retrieved evidence' },
          ],
          thinking: { type: 'enabled' },
          reasoning_effort: 'high',
          temperature: 1.0,
          max_tokens: 4_096,
          stream: true,
        },
      },
    ])
  })

  it.each(['', 'The patient is bruised and sore, especially after an injury.'])(
    'rejects length-limited responses (%j)',
    async (content) => {
      const fetch = fakeFetch(sse(delta(content, { finish_reason: 'length' })))

      await expect(client(fetch).generate('prompt', { systemInstruction: 'instruction' })).rejects.toThrow(
        TokenExhaustionError,
      )
    },
  )

  it('reads events split across chunks and CRLF line endings', async () => {
    const fetch = fakeFetch(stream('data: {"choices":[{"delta":{"con', 'tent":"Split."}}]}\r\n\r\n', 'data: [DONE]\r\n'))

    expect(await client(fetch).generate('prompt', { systemInstruction: 'instruction' })).toBe('Split.')
  })

  it.each([
    sse({ choices: [] }),
    sse({ error: { message: 'provider secret' } }),
    sse(delta('  ')),
    stream('data: not json\n\n'),
    new Response(null, { status: 200 }),
  ])('rejects unusable responses', async (response) => {
    await expect(client(fakeFetch(response)).generate('prompt', { systemInstruction: 'instruction' })).rejects.toThrow(
      ProviderError,
    )
  })

  it('requires a key', () => {
    expect(
      () => new ZaiChatClient({ apiKey: undefined, model: 'glm-5.3-flash', maxOutputTokens: 4_096 }),
    ).toThrow(/ZAI_API_KEY/)
  })

  it.each([timeout(), json({}, 504)])('classifies timeouts without exposing details', async (response) => {
    const error = await client(fakeFetch(response))
      .generate('prompt', { systemInstruction: 'instruction' })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ProviderTimeoutError)
    expect(String(error)).toMatch(/timed out/)
    expect(String(error)).not.toContain('timeout secret')
  })

  it('does not include provider response bodies in errors', async () => {
    const fetch = fakeFetch(new Response('provider secret response', { status: 502 }))

    const error = await client(fetch)
      .generate('prompt', { systemInstruction: 'instruction' })
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(ProviderError)
    expect(String(error)).toMatch(/status 502/)
    expect(String(error)).not.toContain('provider secret response')
  })
})
