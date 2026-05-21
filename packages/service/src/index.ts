import 'dotenv/config'
import { createRequire } from 'module'
import { serve } from '@hono/node-server'
import logger from './lib/logger.js'
import { buildApp } from './app.js'

const require = createRequire(import.meta.url)
const { version: SERVICE_VERSION } = require('../package.json') as { version: string }

const app = buildApp({ version: SERVICE_VERSION })

// ── 启动前安全检查 ────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production'

if (IS_PROD && !process.env.API_TOKEN) {
  logger.error('API_TOKEN is required in production. Set API_TOKEN env var and restart.')
  process.exit(1)
}

if (!process.env.API_TOKEN) {
  logger.warn('API_TOKEN not set — authentication is DISABLED (development mode only)')
}

if (IS_PROD && !process.env.CORS_ORIGINS) {
  logger.warn('CORS_ORIGINS not set in production — all cross-origin requests will be REJECTED. Set CORS_ORIGINS to a comma-separated allow list (or "*" to explicitly allow all).')
}

// ── 启动 ──────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3300

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Taxcon running on http://localhost:${info.port}`)
  logger.info(`  docs: http://localhost:${info.port}/docs`)
})
