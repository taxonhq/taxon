/**
 * Webhook 管理 API（#34）。admin 专属。
 *
 *   GET    /webhooks                              列出（secret 脱敏）
 *   POST   /webhooks                              创建（一次性返回完整 secret）
 *   GET    /webhooks/:id                          详情（secret 脱敏）
 *   PATCH  /webhooks/:id                          更新 name/url/events/scopes/active
 *   DELETE /webhooks/:id                          删除（级联投递记录）
 *   GET    /webhooks/:id/deliveries               最近投递记录
 *   POST   /webhooks/:id/deliveries/:did/replay   重放某次投递（重排为 pending）
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { randomBytes } from 'node:crypto'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'
import { isPrismaError } from '../lib/errors.js'
import { requireRole } from '../middleware/auth.js'
import { WEBHOOK_EVENTS } from '../lib/events.js'
import { ApiError, OkMessage, okData } from '../lib/schemas.js'

export const webhooksRouter = new OpenAPIHono()

// ── schemas ─────────────────────────────────────────────────────────────────────
const EventEnum = z.enum(WEBHOOK_EVENTS)

const WebhookSchema = z.object({
  id:          z.string(),
  name:        z.string(),
  url:         z.string(),
  secretMask:  z.string().openapi({ description: 'secret 脱敏显示，仅创建时返回完整值' }),
  events:      z.array(z.string()),
  scopes:      z.array(z.string()),
  active:      z.boolean(),
  createdAt:   z.string(),
  updatedAt:   z.string(),
  lastFiredAt: z.string().nullable(),
}).openapi('Webhook')

const CreatedWebhookSchema = WebhookSchema.extend({
  secret: z.string().openapi({ description: 'HMAC 签名密钥，仅此一次可见' }),
}).openapi('CreatedWebhook')

const CreateWebhookBody = z.object({
  name:   z.string().min(1).max(100),
  url:    z.string().url().refine(u => /^https?:\/\//.test(u), 'url 必须是 http(s)'),
  events: z.array(EventEnum).min(1).openapi({ description: `订阅事件，可选：${WEBHOOK_EVENTS.join(', ')}` }),
  scopes: z.array(z.string()).optional().openapi({ description: 'entityType 白名单，空=全部' }),
  secret: z.string().min(8).max(200).optional().openapi({ description: '不传则自动生成' }),
}).openapi('CreateWebhookBody')

const UpdateWebhookBody = z.object({
  name:   z.string().min(1).max(100).optional(),
  url:    z.string().url().refine(u => /^https?:\/\//.test(u), 'url 必须是 http(s)').optional(),
  events: z.array(EventEnum).min(1).optional(),
  scopes: z.array(z.string()).optional(),
  active: z.boolean().optional(),
}).openapi('UpdateWebhookBody')

const DeliverySchema = z.object({
  id:           z.string(),
  event:        z.string(),
  status:       z.string(),
  attempts:     z.number().int(),
  responseCode: z.number().int().nullable(),
  responseBody: z.string().nullable(),
  nextRetryAt:  z.string().nullable(),
  createdAt:    z.string(),
  deliveredAt:  z.string().nullable(),
}).openapi('WebhookDelivery')

// secret 脱敏：保留前 8 位
const mask = (s: string) => (s.length <= 8 ? '****' : s.slice(0, 8) + '…')
type WebhookRow = {
  id: string; name: string; url: string; secret: string; events: string[]; scopes: string[]
  active: boolean; createdAt: Date; updatedAt: Date; lastFiredAt: Date | null
}
const toPublic = (w: WebhookRow) => ({
  id: w.id, name: w.name, url: w.url, secretMask: mask(w.secret),
  events: w.events, scopes: w.scopes, active: w.active,
  createdAt: w.createdAt.toISOString(), updatedAt: w.updatedAt.toISOString(),
  lastFiredAt: w.lastFiredAt?.toISOString() ?? null,
})

// 全部 admin 专属
webhooksRouter.use('/*', requireRole('admin'))

// ── GET /webhooks ─────────────────────────────────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'get', path: '/',
  tags: ['Webhook'], summary: '列出 webhooks', security: [{ BearerAuth: [] }],
  responses: { 200: { content: { 'application/json': { schema: okData(z.array(WebhookSchema)) } }, description: '成功' } },
}), async (c) => {
  const rows = await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } })
  return c.json({ code: 0, data: rows.map(toPublic) }, 200)
})

// ── POST /webhooks ────────────────────────────────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'post', path: '/',
  tags: ['Webhook'], summary: '创建 webhook（一次性返回 secret）', security: [{ BearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: CreateWebhookBody } }, required: true } },
  responses: {
    200: { content: { 'application/json': { schema: okData(CreatedWebhookSchema) } }, description: '成功，secret 仅此一次可见' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
}), async (c) => {
  const { name, url, events, scopes, secret } = c.req.valid('json')
  const finalSecret = secret ?? 'whsec_' + randomBytes(24).toString('hex')
  const w = await prisma.webhook.create({
    data: { name: name.trim(), url, events, scopes: scopes ?? [], secret: finalSecret },
  })
  return c.json({ code: 0, data: { ...toPublic(w), secret: finalSecret } }, 200)
})

// ── GET /webhooks/:id ─────────────────────────────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'get', path: '/{id}',
  tags: ['Webhook'], summary: 'webhook 详情', security: [{ BearerAuth: [] }],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { content: { 'application/json': { schema: okData(WebhookSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
}), async (c) => {
  const { id } = c.req.valid('param')
  const w = await prisma.webhook.findUnique({ where: { id } })
  if (!w) return c.json({ code: 404, message: 'webhook 不存在' }, 404)
  return c.json({ code: 0, data: toPublic(w) }, 200)
})

// ── PATCH /webhooks/:id ───────────────────────────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'patch', path: '/{id}',
  tags: ['Webhook'], summary: '更新 webhook', security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    body: { content: { 'application/json': { schema: UpdateWebhookBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(WebhookSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
}), async (c) => {
  const { id } = c.req.valid('param')
  const body = c.req.valid('json')
  try {
    const w = await prisma.webhook.update({ where: { id }, data: body })
    return c.json({ code: 0, data: toPublic(w) }, 200)
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return c.json({ code: 404, message: 'webhook 不存在' }, 404)
    throw e
  }
})

// ── DELETE /webhooks/:id ──────────────────────────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'delete', path: '/{id}',
  tags: ['Webhook'], summary: '删除 webhook', security: [{ BearerAuth: [] }],
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
}), async (c) => {
  const { id } = c.req.valid('param')
  try {
    await prisma.webhook.delete({ where: { id } })
    return c.json({ code: 0, message: '已删除' }, 200)
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return c.json({ code: 404, message: 'webhook 不存在' }, 404)
    throw e
  }
})

// ── GET /webhooks/:id/deliveries ──────────────────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'get', path: '/{id}/deliveries',
  tags: ['Webhook'], summary: '最近投递记录', security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ limit: z.string().optional() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(DeliverySchema)) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: 'webhook 不存在' },
  },
}), async (c) => {
  const { id } = c.req.valid('param')
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50')))
  const exists = await prisma.webhook.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return c.json({ code: 404, message: 'webhook 不存在' }, 404)
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhookId: id }, orderBy: { createdAt: 'desc' }, take: limit,
  })
  return c.json({
    code: 0,
    data: rows.map(d => ({
      id: d.id, event: d.event, status: d.status, attempts: d.attempts,
      responseCode: d.responseCode, responseBody: d.responseBody,
      nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(), deliveredAt: d.deliveredAt?.toISOString() ?? null,
    })),
  }, 200)
})

// ── POST /webhooks/:id/deliveries/:did/replay ─────────────────────────────────
webhooksRouter.openapi(createRoute({
  method: 'post', path: '/{id}/deliveries/{did}/replay',
  tags: ['Webhook'], summary: '重放投递（重排为 pending 立即重试）', security: [{ BearerAuth: [] }],
  request: { params: z.object({ id: z.string().min(1), did: z.string().min(1) }) },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '已重排，下一轮 worker 重试' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '投递不存在' },
  },
}), async (c) => {
  const { id, did } = c.req.valid('param')
  const d = await prisma.webhookDelivery.findFirst({ where: { id: did, webhookId: id }, select: { id: true } })
  if (!d) return c.json({ code: 404, message: '投递记录不存在' }, 404)
  await prisma.webhookDelivery.update({
    where: { id: did },
    data: { status: 'pending', attempts: 0, nextRetryAt: new Date(), responseCode: null, responseBody: null, deliveredAt: null },
  })
  logger.info({ webhookId: id, deliveryId: did }, 'webhook delivery replay requested')
  return c.json({ code: 0, message: '已重排，将在下一轮重试' }, 200)
})
