/** Asks Claude through the Claude Code CLI, on its signed-in subscription. */

import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'

const TIMEOUT_MS = 300_000

export interface ClaudeReply {
  text: string
  tokens: { prompt: number; completion: number }
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

/** Claude's reply to `prompt`, without tools, or an error when the CLI fails. */
export function askClaude(prompt: string, { model, system }: { model: string; system: string }): Promise<ClaudeReply> {
  // Without an API key the CLI bills the subscription, and outside a Claude Code session it may
  // start a nested one. Running from a temporary folder keeps project instructions out.
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.CLAUDECODE
  const args = [
    '--print',
    '--model', model,
    '--output-format', 'json',
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--system-prompt', system,
  ]
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      args,
      { cwd: tmpdir(), env, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let parsed: CliResult
        try {
          parsed = JSON.parse(stdout) as CliResult
        } catch {
          reject(new Error(`claude CLI failed: ${error?.message ?? ''} ${stderr}`.trim()))
          return
        }
        if (parsed.is_error || typeof parsed.result !== 'string') {
          reject(new Error(`claude CLI failed: ${parsed.result ?? stderr}`))
          return
        }
        const { input_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = parsed.usage ?? {}
        resolve({
          text: parsed.result,
          tokens: { prompt: input_tokens + cache_creation_input_tokens + cache_read_input_tokens, completion: parsed.usage?.output_tokens ?? 0 },
        })
      },
    )
    child.stdin?.end(prompt)
  })
}
