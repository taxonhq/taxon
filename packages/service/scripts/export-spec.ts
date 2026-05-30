/**
 * export-spec.ts
 *
 * Writes the OpenAPI spec to a static JSON file.
 * Run with:  pnpm gen:spec
 *
 * The output file (openapi.json at the repo root) is consumed by:
 *  - `packages/console` — `pnpm gen:types` to generate TypeScript client types
 *  - CI drift check — diff against previous commit to detect unintentional changes
 *
 * The spec is now generated dynamically from the route definitions via
 * @hono/zod-openapi, so there is no hand-written openapi.ts to maintain.
 */

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath   = resolve(__dirname, '../../..', 'openapi.json')

const app  = buildApp({ silent: true })
// getOpenAPIDocument() collects all createRoute() definitions registered on the app
const spec = (app as any).getOpenAPIDocument({
  openapi: '3.0.0',
  info: {
    title: 'Taxon Tag Service',
    version: '1.0.0',
    description: 'Standalone tagging microservice — tag groups, entity tagging, audit workflow',
  },
  security: [{ BearerAuth: [] }],
})

writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
console.log(`✓  OpenAPI spec written to ${outPath}`)

// buildApp() 实例化 Prisma client，其连接池会让事件循环常驻、进程不退出。
// 本脚本只生成静态 spec、不查询 DB，显式退出避免 `pnpm gen:spec` 挂起。
process.exit(0)
