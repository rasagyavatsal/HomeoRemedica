/** Start the API and Vite together, and stop both when either exits. */

import { type ChildProcess, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
  return true
}

async function stop(processes: readonly ChildProcess[]): Promise<void> {
  const pids = processes.flatMap((child) => (child.pid === undefined ? [] : [child.pid]))
  for (const pid of pids) signalGroup(pid, 'SIGTERM')
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (!pids.some(groupExists)) return
    await delay(100)
  }
  for (const pid of pids) signalGroup(pid, 'SIGKILL')
}

async function main(): Promise<number> {
  const commands: [string, string[]][] = [
    [process.execPath, ['--watch', 'src/api/server.ts']],
    ['npm', ['--prefix', 'web', 'run', 'dev', '--', '--port', '5173', '--strictPort']],
  ]
  const processes: ChildProcess[] = []
  const finished = Promise.withResolvers<number>()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => finished.resolve(0))
  try {
    for (const [command, args] of commands) {
      // Each server gets its own process group so stopping it also stops its children.
      const child = spawn(command, args, { cwd: ROOT, detached: true, stdio: 'inherit' })
      child.once('error', (error) => {
        console.error(`Could not start the web app: ${error.message}`)
        finished.resolve(1)
      })
      child.once('exit', (code) => finished.resolve(code ?? 1))
      processes.push(child)
    }
    console.log('HomeoRemedica: http://127.0.0.1:5173 (Ctrl+C stops both servers)')
    return await finished.promise
  } finally {
    await stop(processes)
  }
}

process.exit(await main())
