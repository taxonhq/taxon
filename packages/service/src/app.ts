/**
 * App builder — constructs the Hono app with all middleware and routes mounted.
 *
 * Exported as a function so tests can build a fresh app per test run
 * without triggering side effects (HTTP server start, env validation, etc.)
 * that live in src/index.ts.
 */

import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { bearerAuth } from './middleware/auth.js'
import { rateLimit } from './middleware/rate-limit.js'
import { requestIdMiddleware, getRequestId } from './middleware/request-id.js'
import { validateEntityParams } from './middleware/validate-params.js'
import prisma from './lib/db.js'
import logger from './lib/logger.js'
import { registry, httpRequestsTotal, httpRequestDuration, normalizeRoute } from './lib/metrics.js'
import { entities } from './routes/entities.js'
import { tagGroups } from './routes/tag-groups.js'
import { tags } from './routes/tags/index.js'
import { tagAliases } from './routes/tag-aliases.js'
import { tokensRouter } from './routes/tokens.js'
import { dashboardMetrics } from './routes/metrics-dashboard.js'
import { searchRouter } from './routes/search.js'
import { entityGraphRouter } from './routes/entity-graph.js'
import { llmConfigRouter } from './routes/llm-config.js'
import { systemConfigRouter } from './routes/system-config.js'
import { governanceRouter } from './routes/governance.js'
import { webhooksRouter } from './routes/webhooks.js'

export interface AppOptions {
  /** Service version for /health output (defaults to "unknown" if not provided). */
  version?: string
  /** Disable request logging — used by tests to keep output quiet. */
  silent?: boolean
}

export function buildApp(opts: AppOptions = {}) {
  const app = new OpenAPIHono({
    // 将 @hono/zod-openapi 默认的 {success,error} 校验错误包装为项目统一的 {code,message} 格式
    defaultHook: (result, c) => {
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? 'Validation error'
        return c.json({ code: 422, message: msg }, 422)
      }
    },
  })
  const version = opts.version ?? 'unknown'

  // BearerAuth セキュリティスキームをレジストリに登録（app.doc の components は Omit されているため）
  app.openAPIRegistry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'Bearer API Token',
  })

  // ── Security headers ────────────────────────────────────────────
  // X-Content-Type-Options: nosniff, X-Frame-Options: DENY,
  // Strict-Transport-Security (HSTS), X-XSS-Protection, Referrer-Policy.
  // Content-Security-Policy is intentionally omitted here — the service is a
  // pure JSON API; CSP is more relevant for the Next.js console.
  app.use('/*', secureHeaders({
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    // CSP intentionally omitted: this is a pure JSON API + Scalar docs UI.
    // The /docs page loads external scripts from cdn.jsdelivr.net; a tight
    // CSP here would break the interactive docs without adding meaningful
    // security value to a JSON endpoint.
  }))

  // ── Request ID ──────────────────────────────────────────────────
  app.use('/*', requestIdMiddleware)

  // ── CORS ────────────────────────────────────────────────────────
  // 安全策略：
  // - 未设置 CORS_ORIGINS：仅在开发模式（NODE_ENV !== 'production'）下放行任意来源，
  //   生产环境直接拒绝（避免反射任意 origin + credentials 的高危默认值）。
  // - 设置 CORS_ORIGINS：精确白名单匹配，支持 "*" 显式声明全开。
  const corsOriginsEnv  = process.env.CORS_ORIGINS
  const allowedOrigins  = corsOriginsEnv ? corsOriginsEnv.split(',').map(s => s.trim()) : null
  const allowAnyOrigin  = allowedOrigins?.includes('*') ?? false
  const isProd          = process.env.NODE_ENV === 'production'

  app.use('/*', cors({
    origin: (origin) => {
      if (allowAnyOrigin) return origin || '*'
      if (allowedOrigins) return allowedOrigins.includes(origin) ? origin : null
      return isProd ? null : (origin || '*')
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  }))

  // ── 请求日志 + HTTP 指标 ────────────────────────────────────────
  app.use('/*', async (c, next) => {
    const start = performance.now()
    await next()
    const durationSec = (performance.now() - start) / 1000
    const route  = normalizeRoute(c.req.path)
    const method = c.req.method
    const status = String(c.res.status)

    if (!opts.silent) {
      logger.info(
        { requestId: getRequestId(c), method, path: c.req.path, status: c.res.status, durationMs: Math.round(durationSec * 1000) },
        `${method} ${c.req.path} ${c.res.status} ${Math.round(durationSec * 1000)}ms`,
      )
    }
    httpRequestsTotal.labels(method, route, status).inc()
    httpRequestDuration.labels(method, route).observe(durationSec)
  })

  // ── 公开端点 ────────────────────────────────────────────────────

  // Liveness: 进程存活即 200，不依赖 DB
  app.get('/health/live', (c) => c.json({ status: 'ok' }))

  // Readiness: DB 可达才 200
  app.get('/health/ready', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ status: 'ok', db: 'ok' })
    } catch {
      logger.error('Health/ready: DB ping failed')
      return c.json({ status: 'degraded', db: 'error' }, 503)
    }
  })

  // Full health: 兼容旧客户端
  app.get('/health', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({
        status: 'ok', db: 'ok',
        timestamp: new Date().toISOString(),
        version, nodeVersion: process.version,
      })
    } catch {
      logger.error('Health check: DB ping failed')
      return c.json({
        status: 'degraded', db: 'error',
        timestamp: new Date().toISOString(),
        version, nodeVersion: process.version,
      }, 503)
    }
  })

  // Prometheus 指标抓取端点
  app.get('/metrics', async (c) => {
    const metrics = await registry.metrics()
    c.header('Content-Type', registry.contentType)
    return c.body(metrics)
  })

  app.get('/', (c) => c.json({ code: 0, message: 'Taxcon OK' }))

  app.get('/favicon.svg', (c) => {
    c.header('Content-Type', 'image/svg+xml')
    c.header('Cache-Control', 'public, max-age=86400')
    return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#111"/>
  <path d="M5 7 H19.5 L27 16 L19.5 25 H5 Z" fill="none" stroke="white" stroke-width="2.2"
        stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="10.5" cy="16" r="2.2" fill="white"/>
</svg>`)
  })

  // OpenAPI 3.0 仕様を自動生成（@hono/zod-openapi が各ルートの createRoute 定義から構築）
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'Taxon Tag Service',
      version: '1.0.0',
      description: 'Standalone tagging microservice — tag groups, entity tagging, audit workflow',
    },
    security: [{ BearerAuth: [] }],
  })

  app.get('/docs', (c) => {
    const defaultToken = process.env.SCALAR_BEARER_TOKEN ?? ''
    const authConfig = JSON.stringify({
      preferredSecurityScheme: 'BearerAuth',
      http: { bearer: { token: defaultToken } },
    })
    return c.html(`<!doctype html>
<html><head><title>Taxon API</title><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" /></head>
<body><div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  <script>Scalar.createApiReference('#app', {
    url: '/openapi.json',
    authentication: ${authConfig},
  })</script>
</body></html>`)
  })

  // ── 速率限制 ────────────────────────────────────────────────────
  // 双层策略：
  //   globalLimiter — 每 IP 300 req/min（含读），防流量风暴
  //   writeLimiter  — 每 IP 60 req/min（仅写操作），防批量写滥用
  // 生产建议在反向代理（Nginx / Caddy）层再加一道基于连接数的硬限制。
  // 通过 RATE_LIMIT_MAX / RATE_LIMIT_WRITE_MAX 环境变量可覆盖默认值。
  const PROTECTED = ['/entities/*', '/tag-groups/*', '/tags/*', '/entity-types', '/tokens', '/tokens/*', '/entity-graph/*', '/webhooks/*']
  const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

  const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    label: 'global',
  })
  const writeLimiter = rateLimit({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_WRITE_MAX) || 60,
    methods: WRITE_METHODS,
    label: 'write',
  })

  for (const path of PROTECTED) {
    app.use(path, globalLimiter)
    app.use(path, writeLimiter)
  }

  // ── 认证保护 ────────────────────────────────────────────────
  // bearerAuth：API_TOKEN 未设置且无 DB token 时跳过（本地开发/测试）
  // tokenAuth ：识别 Bearer Token 并写入角色，/tokens 路由专用
  app.use('/entities/*',   bearerAuth)
  app.use('/tag-groups/*', bearerAuth)
  app.use('/tags/*',       bearerAuth)
  app.use('/entity-types', bearerAuth)
  app.use('/tokens',       bearerAuth)
  app.use('/tokens/*',     bearerAuth)
  app.use('/search/*',      bearerAuth)
  app.use('/settings/*',    bearerAuth)
  app.use('/governance/*',  bearerAuth)
  app.use('/entity-graph/*', bearerAuth)
  app.use('/webhooks/*',    bearerAuth)
  app.use('/webhooks',      bearerAuth)

  // ── 实体路径参数格式校验 ────────────────────────────────────────
  app.use('/entities/:entityType', validateEntityParams)
  app.use('/entities/:entityType/:entityId', validateEntityParams)
  app.use('/entities/:entityType/:entityId/*', validateEntityParams)

  // ── 业务路由 ────────────────────────────────────────────────────
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

  app.route('/entities',   entities)
  app.route('/tag-groups', tagGroups)
  app.route('/tags',       tags)
  // aliases 挂在 /tags/:tagId/aliases 下
  app.route('/tags/:tagId/aliases', tagAliases)
  app.route('/tokens',     tokensRouter)
  app.route('/metrics',    dashboardMetrics)
  app.route('/search',     searchRouter)
  app.route('/entity-graph', entityGraphRouter)
  app.route('/settings',    llmConfigRouter)
  app.route('/settings',    systemConfigRouter)
  app.route('/governance',  governanceRouter)
  app.route('/webhooks',    webhooksRouter)

  // ── Dashboard 布局配置 ──────────────────────────────────────────
  app.get('/dashboard/layout', async (c) => {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'dashboard-layout' } })
    return c.json({ code: 0, data: cfg?.value ?? null })
  })

  app.put('/dashboard/layout', async (c) => {
    const body = await c.req.json<{ layout: unknown }>()
    // Accept either a raw array (legacy) or a versioned object { version, items }
    const payload = body?.layout
    const isVersioned = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).version === 'number'
      && Array.isArray((payload as Record<string, unknown>).items)
    const isArray = Array.isArray(payload)
    if (!isVersioned && !isArray) {
      return c.json({ code: 400, message: 'layout 必须为数组或 { version, items } 对象' }, 400)
    }
    const cfg = await prisma.systemConfig.upsert({
      where:  { key: 'dashboard-layout' },
      create: { key: 'dashboard-layout', value: payload as object },
      update: { value: payload as object },
    })
    return c.json({ code: 0, data: cfg.value })
  })

  // ── 兜底错误处理 ────────────────────────────────────────────────
  app.onError((err, c) => {
    logger.error({ err, requestId: getRequestId(c), method: c.req.method, path: c.req.path }, 'Unhandled error')
    return c.json({ code: 500, message: '服务内部错误' }, 500)
  })

  return app
}
