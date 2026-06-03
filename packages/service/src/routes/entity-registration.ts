import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/router.js'
import { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import { emitEvent } from '../lib/events.js'
import { RegisteredEntitySchema, RegisterEntityBody, ApiError, OkMessage, okData } from '../lib/schemas.js'

export const registrationRouter = createRouter()

const EntityParams = z.object({
  entityType: z.string().min(1).openapi({ description: '实体类型，如 dish / dining' }),
  entityId:   z.string().min(1).openapi({ description: '实体唯一标识符' }),
})

// ── POST /:entityType/:entityId ───────────────────────────────────────────────
const registerRoute = createRoute({
  method: 'post', path: '/{entityType}/{entityId}',
  tags: ['实体'],
  summary: '注册实体',
  description: '幂等注册：已注册的实体重复调用时，若传入 metadata 则更新，否则保留原值。',
  security: [{ BearerAuth: [] }],
  request: {
    params: EntityParams,
    body: { content: { 'application/json': { schema: RegisterEntityBody } }, required: false },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '注册成功' },
  },
})

registrationRouter.use('/:entityType/:entityId', requireRole('writer'))
registrationRouter.openapi(registerRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  let body: { metadata?: Record<string, string> } = {}
  try { body = await c.req.json() } catch { /* body 可选 */ }

  const metadata = body.metadata ?? null

  await prisma.$transaction(async (tx) => {
    const existed = await tx.registeredEntity.findUnique({
      where: { entityType_entityId: { entityType, entityId } }, select: { entityType: true },
    })
    await tx.registeredEntity.upsert({
      where:  { entityType_entityId: { entityType, entityId } },
      create: { entityType, entityId, ...(metadata ? { metadata } : {}) },
      // 有 metadata 传入则更新；未传则保留原值（不覆盖）
      update: metadata ? { metadata } : {},
    })
    // 仅首次注册时发事件（幂等重复调用不重发）
    if (!existed) await emitEvent(tx, 'entity.registered', { entityType, entityId })
  })
  return c.json({ code: 0, message: '注册成功' }, 200)
})

// ── PATCH /:entityType/:entityId ──────────────────────────────────────────────
const updateEntityRoute = createRoute({
  method: 'patch', path: '/{entityType}/{entityId}',
  tags: ['实体'],
  summary: '更新实体 metadata',
  description: '全量替换 metadata；传 null 清空；实体不存在则 404。',
  security: [{ BearerAuth: [] }],
  request: {
    params: EntityParams,
    body: { content: { 'application/json': { schema: RegisterEntityBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '更新成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '实体未注册' },
  },
})

registrationRouter.openapi(updateEntityRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  const body = c.req.valid('json')
  try {
    await prisma.registeredEntity.update({
      where: { entityType_entityId: { entityType, entityId } },
      data:  { metadata: body.metadata ?? Prisma.DbNull },
    })
    return c.json({ code: 0, message: '更新成功' }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025')) return c.json({ code: 404, message: '实体未注册' }, 404)
    logger.error({ err: error, entityType, entityId }, 'PATCH entity metadata error')
    throw error
  }
})

// ── DELETE /:entityType/:entityId ─────────────────────────────────────────────
const unregisterRoute = createRoute({
  method: 'delete', path: '/{entityType}/{entityId}',
  tags: ['实体'],
  summary: '注销实体（级联删除所有标签关联）',
  security: [{ BearerAuth: [] }],
  request: { params: EntityParams },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '未注册' },
  },
})

registrationRouter.openapi(unregisterRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  try {
    await prisma.$transaction(async (tx) => {
      await tx.registeredEntity.delete({ where: { entityType_entityId: { entityType, entityId } } })
      await emitEvent(tx, 'entity.unregistered', { entityType, entityId })
    })
    return c.json({ code: 0, message: '注销成功' }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025')) return c.json({ code: 404, message: '实体未注册' }, 404)
    logger.error({ err: error, entityType, entityId }, 'Unregister entity error')
    throw error
  }
})

// ── GET /:entityType/:entityId ────────────────────────────────────────────────
const checkEntityRoute = createRoute({
  method: 'get', path: '/{entityType}/{entityId}',
  tags: ['实体'],
  summary: '查询实体是否已注册',
  request: { params: EntityParams },
  responses: {
    200: { content: { 'application/json': { schema: okData(RegisteredEntitySchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '未注册' },
  },
})

registrationRouter.openapi(checkEntityRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  const entity = await prisma.registeredEntity.findUnique({
    where:  { entityType_entityId: { entityType, entityId } },
    select: { entityType: true, entityId: true, registeredAt: true, metadata: true },
  })
  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)
  return c.json({
    code: 0,
    data: {
      ...entity,
      registeredAt: entity.registeredAt.toISOString(),
      metadata: entity.metadata as Record<string, string> | null,
    },
  }, 200)
})
