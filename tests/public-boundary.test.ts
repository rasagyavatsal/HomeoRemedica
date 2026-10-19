import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAX_TRACKED_FILE_BYTES = 8_000_000
const FORBIDDEN_ROOTS = new Set(['build', 'artifacts', 'corpora', 'dataset', 'dist', 'output', 'server-data'])
const FORBIDDEN_SUFFIXES = new Set(['.db', '.gz', '.sqlite', '.sqlite3', '.tar', '.tgz', '.whl', '.zip', '.zst'])
// Only the HTTP entry points may depend on the web framework.
const HTTP_ENTRY_POINTS = new Set(['src/server/app.ts', 'src/server/server.ts'])
const IMPORT_STATEMENT =
  /\b(?:import|export)(\s+type)?\s(?:[^'"]*?\sfrom\s)?\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

interface ImportReference {
  specifier: string
  typeOnly: boolean
}

function imports(source: string): ImportReference[] {
  return [...source.matchAll(IMPORT_STATEMENT)].map((match) => ({
    specifier: match[2] ?? match[3] ?? '',
    typeOnly: Boolean(match[1]),
  }))
}

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

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(directory, name))
}

function layerViolations(): string[] {
  const found: string[] = []
  for (const path of [...sourceFiles('src/server'), ...sourceFiles('src/web')]) {
    const layer = path.split('/')[1]
    for (const { specifier, typeOnly } of imports(readFileSync(join(ROOT, path), 'utf8'))) {
      const target = specifier.startsWith('.')
        ? relative(join(ROOT, 'src'), resolve(dirname(join(ROOT, path)), specifier)).split('/')[0]
        : undefined
      if (layer === 'server' && target === 'web') found.push(`server imports the frontend: ${path} imports ${specifier}`)
      // A value import would bundle server code, and possibly secrets, into the browser.
      if (layer === 'web' && target === 'server' && !typeOnly) {
        found.push(`frontend value-imports the server: ${path} imports ${specifier}; use import type`)
      }
      if (/^(hono|@hono\/)/.test(specifier) && !HTTP_ENTRY_POINTS.has(path)) {
        found.push(`web framework outside the HTTP layer: ${path} imports ${specifier}`)
      }
    }
  }
  return found
}

it('keeps the repository and package boundaries clean', () => {
  const found = [...violations(), ...layerViolations()]

  expect(found, found.join('\n')).toEqual([])
})

it('recognizes type-only and value imports', () => {
  const source = [
    "import type { Citation } from '../server/contracts.ts'",
    "import { createApp } from '../server/app.ts'",
    'export { x } from "./qdrant.ts"',
    "const lazy = import('hono')",
  ].join('\n')

  expect(imports(source)).toEqual([
    { specifier: '../server/contracts.ts', typeOnly: true },
    { specifier: '../server/app.ts', typeOnly: false },
    { specifier: './qdrant.ts', typeOnly: false },
    { specifier: 'hono', typeOnly: false },
  ])
})
