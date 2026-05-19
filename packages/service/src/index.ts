import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bearerAuth } from './middleware/auth.js'
import { validateEntityParams } from './middleware/validate-params.js'
import prisma from './lib/db.js'
import logger from './lib/logger.js'
import { entities } from './routes/entities.js'
import { tagGroups } from './routes/tag-groups.js'
import { tags } from './routes/tags.js'
import { openApiSpec } from './openapi.js'

const app = new Hono()

// ── CORS ──────────────────────────────────────────────────────────
const CORS_ORIGINS = process.env.CORS_ORIGINS
const ALLOWED_ORIGINS = CORS_ORIGINS ? CORS_ORIGINS.split(',').map(s => s.trim()) : null

app.use('/*', cors({
  origin: (origin) => {
    if (!ALLOWED_ORIGINS) return origin
    return ALLOWED_ORIGINS.includes(origin) ? origin : null
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}))

// ── 请求日志 ──────────────────────────────────────────────────────
app.use('/*', async (c, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  logger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`)
})

// ── 公开端点（不需要认证）────────────────────────────────────────
app.get('/health', async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return c.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() })
  } catch {
    logger.error('Health check: DB ping failed')
    return c.json({ status: 'degraded', db: 'error', timestamp: new Date().toISOString() }, 503)
  }
})

app.get('/', (c) => c.json({ code: 0, message: 'Taxcon OK' }))

app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#111"/>
  <path d="M5 7 H19.5 L27 16 L19.5 25 H5 Z"
        fill="none" stroke="white" stroke-width="2.2"
        stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="10.5" cy="16" r="2.2" fill="white"/>
</svg>`)
})

app.get('/openapi.json', (c) => c.json(openApiSpec))
app.get('/docs', (c) => c.html(`<!doctype html>
<html>
  <head>
    <title>Taxon API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>Scalar.createApiReference('#app', { url: '/openapi.json' })</script>
  </body>
</html>`))

// ── 认证保护（API_TOKEN 未配置时跳过，方便本地开发）────────────
app.use('/entities/*', bearerAuth)
app.use('/tag-groups/*', bearerAuth)
app.use('/tags/*', bearerAuth)
app.use('/entity-types', bearerAuth)

// ── 实体路径参数格式校验 ──────────────────────────────────────
app.use('/entities/:entityType', validateEntityParams)
app.use('/entities/:entityType/:entityId', validateEntityParams)
app.use('/entities/:entityType/:entityId/*', validateEntityParams)

// ── 业务路由 ──────────────────────────────────────────────────────
app.get('/entity-types', async (c) => {
  const rows = await prisma.registeredEntity.groupBy({
    by: ['entityType'],
    _count: { entityId: true },
    orderBy: { entityType: 'asc' },
  })
  return c.json({
    code: 0,
    data: rows.map((r: { entityType: string; _count: { entityId: number } }) => ({
      entityType: r.entityType,
      count: r._count.entityId,
    })),
  })
})

app.route('/entities', entities)
app.route('/tag-groups', tagGroups)
app.route('/tags', tags)

// ── 兜底错误处理 ──────────────────────────────────────────────────
app.onError((err, c) => {
  logger.error({ err, method: c.req.method, path: c.req.path }, 'Unhandled error')
  return c.json({ code: 500, message: '服务内部错误' }, 500)
})

// ── 启动前安全检查 ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.API_TOKEN) {
  logger.error('API_TOKEN is required in production. Set API_TOKEN env var and restart.')
  process.exit(1)
}

if (!process.env.API_TOKEN) {
  logger.warn('API_TOKEN not set — authentication is DISABLED (development mode only)')
}

// ── 启动 ──────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3300

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Taxcon running on http://localhost:${info.port}`)
  logger.info(`  docs: http://localhost:${info.port}/docs`)
})
