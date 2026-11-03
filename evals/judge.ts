/** A promptfoo grading provider that asks Claude through the Claude Code CLI, on its signed-in subscription. */

import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'

const MODEL = 'claude-sonnet-5-5'
const TIMEOUT_MS = 300_000

interface ProviderResponse {
  output?: string
  error?: string
  tokenUsage?: { prompt: number; completion: number; total: number }
}

interface CliResult {
  result?: string
  is_error?: boolean
  usage?: {
    input_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    output_tokens?: number
  }
}

export default class ClaudeCodeJudge {
  id(): string {
    return `claude-code:${MODEL}`
  }

  callApi(prompt: string): Promise<ProviderResponse> {
    // Without an API key the CLI bills the subscription, and outside a Claude Code session it may
    // start a nested one. Running from a temporary folder keeps project instructions out.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.CLAUDECODE
    const args = [
      '--print',
      '--model', MODEL,
      '--output-format', 'json',
      '--tools', '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--system-prompt', 'You grade answers for an evaluation. Follow the requested output format exactly.',
    ]
    return new Promise((resolve) => {
      const child = execFile(
        'claude',
        args,
        { cwd: tmpdir(), env, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          let parsed: CliResult
          try {
            parsed = JSON.parse(stdout) as CliResult
          } catch {
            resolve({ error: `claude CLI failed: ${error?.message ?? ''} ${stderr}`.trim() })
            return
          }
          if (parsed.is_error || typeof parsed.result !== 'string') {
            resolve({ error: `claude CLI failed: ${parsed.result ?? stderr}` })
            return
          }
          const { input_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = parsed.usage ?? {}
          const prompt = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
          const completion = parsed.usage?.output_tokens ?? 0
          resolve({ output: parsed.result, tokenUsage: { prompt, completion, total: prompt + completion } })
        },
      )
      child.stdin?.end(prompt)
    })
  }
}
