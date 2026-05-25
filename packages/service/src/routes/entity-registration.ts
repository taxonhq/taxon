import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import prisma from '../lib/db.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import { RegisteredEntitySchema, ApiError, OkMessage, okData } from '../lib/schemas.js'

export const registrationRouter = new OpenAPIHono()

const EntityParams = z.object({
  entityType: z.string().min(1).openapi({ description: '实体类型，如 dish / dining' }),
  entityId:   z.string().min(1).openapi({ description: '实体唯一标识符' }),
})

// ── POST /:entityType/:entityId ───────────────────────────────────────────────
const registerRoute = createRoute({
  method: 'post', path: '/{entityType}/{entityId}',
  tags: ['实体'],
  summary: '注册实体',
  security: [{ BearerAuth: [] }],
  request: { params: EntityParams },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '注册成功' },
  },
})

registrationRouter.use('/:entityType/:entityId', requireRole('writer'))
registrationRouter.openapi(registerRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  await prisma.registeredEntity.upsert({
    where:  { entityType_entityId: { entityType, entityId } },
    create: { entityType, entityId },
    update: {},
  })
  return c.json({ code: 0, message: '注册成功' }, 200)
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
    await prisma.registeredEntity.delete({ where: { entityType_entityId: { entityType, entityId } } })
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
    select: { entityType: true, entityId: true, registeredAt: true },
  })
  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)
  return c.json({ code: 0, data: { ...entity, registeredAt: entity.registeredAt.toISOString() } }, 200)
})
