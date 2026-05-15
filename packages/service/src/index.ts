import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import prisma from './lib/db.js'
import { entities } from './routes/entities.js'
import { tagGroups } from './routes/tag-groups.js'
import { tags } from './routes/tags.js'
import { openApiSpec } from './openapi.js'

const app = new Hono()

const CORS_ORIGINS = process.env.CORS_ORIGINS
const ALLOWED_ORIGINS = CORS_ORIGINS
  ? CORS_ORIGINS.split(',').map(s => s.trim())
  : null

app.use('/*', cors({
  origin: (origin) => {
    if (!ALLOWED_ORIGINS) return origin  // 未配置则允许所有来源
    return ALLOWED_ORIGINS.includes(origin) ? origin : null
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.get('/', (c) => c.json({ code: 0, message: 'Taxon service OK' }))

// Favicon：价签形 + 圆孔，深底白线
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

// OpenAPI spec + Scalar UI
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

// 已注册的实体类型（从 RegisteredEntity 表动态统计）
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

const PORT = Number(process.env.PORT) || 3300

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Taxon service running on http://localhost:${info.port}`)
  console.log(`  docs: http://localhost:${info.port}/docs`)
})
