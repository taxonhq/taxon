/**
 * check-openapi-drift.ts
 *
 * Compares the spec generated from the current route definitions against the
 * committed openapi.json file at the repo root. Reports any differences, which
 * indicate that routes/schemas were changed but `pnpm gen:spec` was not re-run.
 *
 * Usage:
 *   pnpm gen:spec          # regenerate openapi.json
 *   pnpm check:openapi     # verify openapi.json is up-to-date with the spec
 *
 * Typical CI flow:
 *   1. pnpm gen:spec
 *   2. git diff --exit-code openapi.json   (fails if spec drifted)
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const specPath   = resolve(__dirname, '../../..', 'openapi.json')

const app  = buildApp({ silent: true })
const spec = (app as any).getOpenAPIDocument({
  openapi: '3.0.0',
  info: {
    title: 'Taxon Tag Service',
    version: '1.0.0',
    description: 'Standalone tagging microservice — tag groups, entity tagging, audit workflow',
  },
  security: [{ BearerAuth: [] }],
})

const currentJson = JSON.stringify(spec, null, 2) + '\n'

// If openapi.json does not exist yet, just write it and succeed
if (!existsSync(specPath)) {
  console.log('openapi.json not found — run `pnpm gen:spec` to create it')
  process.exit(0)
}

const committedJson = readFileSync(specPath, 'utf8')

if (currentJson === committedJson) {
  const paths = Object.keys(spec.paths ?? {})
  console.log(`✓  openapi.json is up-to-date (${paths.length} paths documented)`)
  process.exit(0)
}

// Find which top-level paths changed
const current   = JSON.parse(currentJson) as { paths?: Record<string, unknown> }
const committed = JSON.parse(committedJson) as { paths?: Record<string, unknown> }

const currentPaths   = new Set(Object.keys(current.paths   ?? {}))
const committedPaths = new Set(Object.keys(committed.paths ?? {}))

const added   = [...currentPaths].filter(p => !committedPaths.has(p))
const removed = [...committedPaths].filter(p => !currentPaths.has(p))

if (added.length)   console.error('✗  New paths in spec (not in openapi.json):', added)
if (removed.length) console.error('✗  Paths removed from spec:', removed)
if (!added.length && !removed.length)
  console.error('✗  openapi.json is stale — spec details changed without regenerating.')

console.error('\n   Run `pnpm gen:spec` and commit the updated openapi.json.\n')
process.exit(1)
