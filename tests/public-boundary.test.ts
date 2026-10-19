import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAX_TRACKED_FILE_BYTES = 8_000_000
const FORBIDDEN_ROOTS = new Set(['build', 'artifacts', 'corpora', 'dataset', 'dist', 'output', 'server-data'])
const FORBIDDEN_SUFFIXES = new Set(['.db', '.gz', '.sqlite', '.sqlite3', '.tar', '.tgz', '.whl', '.zip', '.zst'])
// Keep the chat service independent of the web API.
const FORBIDDEN_IMPORTS: Record<string, readonly string[]> = {
  'src/shared': ['production', 'api'],
  'src/production': ['api'],
}
const IMPORT_SPECIFIER = /\b(?:import|export)\s(?:[^'"]*?\sfrom\s)?\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
}

function violations(): string[] {
  const found: string[] = []
  for (const path of trackedFiles()) {
    const absolute = join(ROOT, path)
    if (FORBIDDEN_ROOTS.has(path.split('/')[0] ?? '')) found.push(`forbidden root: ${path}`)
    if (FORBIDDEN_SUFFIXES.has(extname(path).toLowerCase())) found.push(`forbidden artifact: ${path}`)
    let stats
    try {
      stats = lstatSync(absolute)
    } catch {
      continue // Deleted in the working tree but not yet staged.
    }
    if (stats.isSymbolicLink()) found.push(`tracked symlink: ${path}`)
    if (stats.isFile() && stats.size > MAX_TRACKED_FILE_BYTES) found.push(`oversized tracked file: ${path}`)
  }
  return found
}

function pipelineViolations(): string[] {
  const found: string[] = []
  for (const [sourceRoot, forbiddenRoots] of Object.entries(FORBIDDEN_IMPORTS)) {
    const directory = join(ROOT, sourceRoot)
    for (const name of readdirSync(directory).filter((file) => file.endsWith('.ts'))) {
      const path = join(directory, name)
      for (const match of readFileSync(path, 'utf8').matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1] ?? match[2] ?? ''
        if (!specifier.startsWith('.')) continue
        const importedRoot = relative(join(ROOT, 'src'), resolve(dirname(path), specifier)).split('/')[0] ?? ''
        if (forbiddenRoots.includes(importedRoot)) {
          found.push(`invalid package dependency: ${relative(ROOT, path)} imports ${specifier}`)
        }
      }
    }
  }
  return found
}

it('keeps the repository and package boundaries clean', () => {
  const found = [...violations(), ...pipelineViolations()]

  expect(found, found.join('\n')).toEqual([])
})

it('detects a forbidden import', () => {
  const source = "import { createApp } from '../api/app.ts'\nexport { x } from \"../production/qdrant.ts\""
  const specifiers = [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? match[2])

  expect(specifiers).toEqual(['../api/app.ts', '../production/qdrant.ts'])
})
