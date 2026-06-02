import 'dotenv/config'
import { createRequire } from 'module'
import { collectDefaultMetrics } from 'prom-client'
import { serve } from '@hono/node-server'
import logger from './lib/logger.js'
import { buildApp } from './app.js'
import { registry, auditPendingCount } from './lib/metrics.js'
import { startWebhookWorker } from './lib/webhook-worker.js'
import prisma from './lib/db.js'

const require = createRequire(import.meta.url)
const { version: SERVICE_VERSION } = require('../package.json') as { version: string }

const app = buildApp({ version: SERVICE_VERSION })

// ── 可观测性初始化 ────────────────────────────────────────────────
collectDefaultMetrics({ register: registry })

// ── auditPendingCount 初始化 + 定期同步 ──────────────────────────────
// 路由层通过 incAuditGauge / decAuditGauge 做增量更新（每次状态变化 O(1)）；
// 此处定时 5 分钟做一次全量兜底，防止长期漂移（如直连 DB 修改数据）。
async function syncAuditGauge() {
  try {
    const count = await prisma.entityTag.count({ where: { status: 'pending' } })
    auditPendingCount.set(count)
  } catch {
    // 非致命，下次定时器再试
  }
}

syncAuditGauge()
setInterval(syncAuditGauge, 5 * 60_000)  // 5 分钟全量兜底，路由层增量维护

// ── Webhook 投递 worker ───────────────────────────────────────────────
// outbox fan-out + HTTP 投递 + 指数退避重试，每 5 秒一轮。
const WEBHOOK_WORKER_INTERVAL = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS) || 5_000
startWebhookWorker(WEBHOOK_WORKER_INTERVAL)

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

// NEXT_PUBLIC_* variables are bundled into the Next.js client bundle and
// visible to anyone who downloads the page. Warn operators if they expose
// a real API token this way so they can use a server-side proxy instead.
if (IS_PROD && process.env.NEXT_PUBLIC_TAG_SERVICE_TOKEN) {
  logger.warn(
    'NEXT_PUBLIC_TAG_SERVICE_TOKEN is set and will be embedded in the ' +
    'browser bundle — any visitor can read this token. ' +
    'Use a server-side Next.js API route or BFF proxy to keep the token secret.'
  )
}

// ── 启动 ──────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3300

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Taxcon running on http://localhost:${info.port}`)
  logger.info(`  docs: http://localhost:${info.port}/docs`)
})
