/** A promptfoo grading provider that asks Claude through the Claude Code CLI, on its signed-in subscription. */

import { askClaude } from './claude.ts'

const MODEL = 'claude-sonnet-5-5'
const SYSTEM = 'You grade answers for an evaluation. Follow the requested output format exactly.'

interface ProviderResponse {
  output?: string
  error?: string
  tokenUsage?: { prompt: number; completion: number; total: number }
}

export default class ClaudeCodeJudge {
  id(): string {
    return `claude-code:${MODEL}`
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    try {
      const { text, tokens } = await askClaude(prompt, { model: MODEL, system: SYSTEM })
      return { output: text, tokenUsage: { ...tokens, total: tokens.prompt + tokens.completion } }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
}
