import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/router.js'
import { randomBytes, createHash } from 'crypto'
import prisma from '../lib/db.js'
import { requireRole, invalidateTokenCache } from '../middleware/auth.js'
import { isPrismaError } from '../lib/errors.js'
import type { ApiRole } from '../middleware/auth.js'
import { ApiTokenSchema, CreatedTokenSchema, CreateTokenBody, ApiError, OkMessage, okData } from '../lib/schemas.js'

export const tokensRouter = createRouter()

// ── GET /tokens ───────────────────────────────────────────────────────────────
const listTokensRoute = createRoute({
  method: 'get', path: '/',
  tags: ['Token 管理'],
  summary: '列出所有 Token',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(ApiTokenSchema)) } }, description: '成功' },
  },
})

tokensRouter.openapi(listTokensRoute, async (c) => {
  const tokens = await prisma.apiToken.findMany({
    select: { id: true, name: true, role: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return c.json({ code: 0, data: tokens.map(t => ({ ...t, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null, revokedAt: t.revokedAt?.toISOString() ?? null })) }, 200)
})

// ── POST /tokens ──────────────────────────────────────────────────────────────
const createTokenRoute = createRoute({
  method: 'post', path: '/',
  tags: ['Token 管理'],
  summary: '创建 Token（一次性返回明文）',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: { body: { content: { 'application/json': { schema: CreateTokenBody } }, required: true } },
  responses: {
    200: { content: { 'application/json': { schema: okData(CreatedTokenSchema) } }, description: '成功，token 字段仅此一次可见' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
})

tokensRouter.openapi(createTokenRoute, async (c) => {
  const { name, role, scopes } = c.req.valid('json')
  const rawToken  = 'ct_' + randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const token = await prisma.apiToken.create({
    data: { name: name.trim(), tokenHash, role: role as ApiRole, scopes },
    select: { id: true, name: true, role: true, scopes: true, createdAt: true },
  })
  invalidateTokenCache()
  return c.json({ code: 0, data: { ...token, token: rawToken, createdAt: token.createdAt.toISOString(), lastUsedAt: null, revokedAt: null } }, 200)
})

// ── DELETE /tokens/:id ────────────────────────────────────────────────────────
const revokeTokenRoute = createRoute({
  method: 'delete', path: '/{id}',
  tags: ['Token 管理'],
  summary: '撤销 Token',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tokensRouter.openapi(revokeTokenRoute, async (c) => {
  const { id } = c.req.valid('param')
  try {
    await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } })
    invalidateTokenCache()
    return c.json({ code: 0, message: '已撤销' }, 200)
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return c.json({ code: 404, message: 'Token 不存在' }, 404)
    throw e
  }
})
