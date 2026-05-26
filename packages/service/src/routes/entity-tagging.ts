import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Prisma } from '@prisma/client'
import { TagSource, TagStatus } from '@prisma/client'
import prisma from '../lib/db.js'
import { isPrismaError, ValidationError } from '../lib/errors.js'
import { validateTags } from '../lib/validate-tags.js'
import logger from '../lib/logger.js'
import { requireRole, getTokenId } from '../middleware/auth.js'
import { incAuditGauge, decAuditGauge } from '../lib/metrics.js'
import {
  EntityTagItemSchema, TagReviewSchema,
  ReplaceEntityTagsBody, AddEntityTagBody, UpdateEntityTagBody,
  ApiError, OkMessage, okData,
} from '../lib/schemas.js'

const VALID_SOURCES  = new Set<string>(Object.values(TagSource))
const VALID_STATUSES = new Set<string>(Object.values(TagStatus))

export const taggingRouter = new OpenAPIHono()

const EntityTagParams = z.object({
  entityType: z.string().min(1),
  entityId:   z.string().min(1),
})
const EntityTagWithTagIdParams = EntityTagParams.extend({ tagId: z.string().min(1) })

// ── GET /:entityType/:entityId/tags ───────────────────────────────────────────
const getEntityTagsRoute = createRoute({
  method: 'get', path: '/{entityType}/{entityId}/tags',
  tags: ['实体标签'],
  summary: '获取实体标签列表',
  request: {
    params: EntityTagParams,
    query: z.object({ status: z.enum(['active', 'pending', 'rejected', 'all']).optional() }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(EntityTagItemSchema)) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '实体未注册' },
  },
})

taggingRouter.openapi(getEntityTagsRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  const statusParam = c.req.query('status')

  const entity = await prisma.registeredEntity.findUnique({ where: { entityType_entityId: { entityType, entityId } }, select: { entityType: true } })
  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)

  const rows = await prisma.entityTag.findMany({
    where: {
      entityType, entityId,
      ...(statusParam && statusParam !== 'all' ? { status: statusParam as TagStatus } : statusParam !== 'all' ? { status: TagStatus.active } : {}),
    },
    include: { tag: { include: { group: { select: { id: true, slug: true, name: true } } } } },
    orderBy: { createdAt: 'asc' },
  })

  return c.json({
    code: 0,
    data: rows.map(r => ({
      id: r.tag.id, slug: r.tag.slug, name: r.tag.name,
      groupId: r.tag.groupId, group: r.tag.group,
      source: r.source, confidence: r.confidence, status: r.status,
      taggedAt: r.createdAt.toISOString(),
    })),
  }, 200)
})

// ── PUT /:entityType/:entityId/tags ───────────────────────────────────────────
const replaceEntityTagsRoute = createRoute({
  method: 'put', path: '/{entityType}/{entityId}/tags',
  tags: ['实体标签'],
  summary: '全量替换实体标签',
  security: [{ BearerAuth: [] }],
  request: {
    params: EntityTagParams,
    body: { content: { 'application/json': { schema: ReplaceEntityTagsBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    422: { content: { 'application/json': { schema: ApiError } }, description: '标签不合法' },
  },
})

taggingRouter.use('/:entityType/:entityId/tags', requireRole('writer'))
taggingRouter.openapi(replaceEntityTagsRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')
  const body = c.req.valid('json')

  const tagIds    = [...new Set(body.tagIds)]
  const rawSource = body.source ?? 'manual'
  const confidence = body.confidence
  const rawStatus  = body.status ?? (rawSource === 'ai' ? 'pending' : 'active')

  if (!VALID_SOURCES.has(rawSource)) return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (rawSource === 'ai' && confidence == null) return c.json({ code: 400, message: 'AI 来源必须提供 confidence（0~1）' }, 400)
  if (!VALID_STATUSES.has(rawStatus)) return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  const source = rawSource as TagSource
  const status = rawStatus as TagStatus

  const validationError = await validateTags(tagIds, entityType)
  if (validationError) return c.json({ code: 422, message: validationError }, 422)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.registeredEntity.upsert({ where: { entityType_entityId: { entityType, entityId } }, create: { entityType, entityId }, update: {} })
      await tx.$queryRaw`SELECT 1 FROM "RegisteredEntity" WHERE "entityType" = ${entityType} AND "entityId" = ${entityId} FOR UPDATE`
      const deletedPending = await tx.entityTag.count({ where: { entityType, entityId, status: 'pending' } })
      await tx.entityTag.deleteMany({ where: { entityType, entityId } })
      if (tagIds.length > 0) {
        await tx.entityTag.createMany({ data: tagIds.map(tagId => ({ tagId, entityType, entityId, source, confidence, status })) })
      }
      const addedPending = status === 'pending' ? tagIds.length : 0
      const delta = addedPending - deletedPending
      if (delta > 0) incAuditGauge(delta)
      else if (delta < 0) decAuditGauge(-delta)
    })
    return c.json({ code: 0, message: '更新成功' }, 200)
  } catch (error: unknown) {
    logger.error({ err: error, entityType, entityId }, 'PUT entity tags error')
    throw error
  }
})

// ── POST /:entityType/:entityId/tags/:tagId ───────────────────────────────────
// 打标 (writer)、审核 (reviewer)、摘标 (writer) 三种操作共享同一路径，
// 但权限要求不同。这里用 createRoute 的 middleware 字段做 per-route
// 精细化授权，避免 path-level .use() 把所有方法收敛到同一最低门槛。
const addEntityTagRoute = createRoute({
  method: 'post', path: '/{entityType}/{entityId}/tags/{tagId}',
  tags: ['实体标签'],
  summary: '增量打标（单个）',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('writer')] as const,
  request: {
    params: EntityTagWithTagIdParams,
    body: { content: { 'application/json': { schema: AddEntityTagBody } }, required: false },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    403: { content: { 'application/json': { schema: ApiError } }, description: '权限不足' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '标签不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '已打标' },
    422: { content: { 'application/json': { schema: ApiError } }, description: '不允许多选' },
  },
})

taggingRouter.openapi(addEntityTagRoute, async (c) => {
  const { entityType, entityId, tagId } = c.req.valid('param')
  let body: { source?: string; confidence?: number | null; note?: string } = {}
  try { body = await c.req.json() } catch { /* no body */ }

  const rawSource  = (body.source as string | undefined) ?? 'manual'
  const confidence = body.confidence as number | undefined
  const rawStatus  = rawSource === 'ai' ? 'pending' : 'active'

  if (!VALID_SOURCES.has(rawSource)) return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (rawSource === 'ai' && confidence === undefined) return c.json({ code: 400, message: 'AI 来源必须提供 confidence（0~1）' }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const source = rawSource as TagSource
  const status = rawStatus as TagStatus

  let resolvedTagId = tagId
  let tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true, groupId: true, group: { select: { name: true, allowMultiple: true, entityScopes: true, entityRules: { where: { entityType }, select: { allowMultiple: true } } } } },
  })
  if (!tag) {
    const aliasRecord = await prisma.tagAlias.findFirst({
      where: { alias: tagId, tag: { deletedAt: null } },
      include: { tag: { select: { id: true, groupId: true, group: { select: { name: true, allowMultiple: true, entityScopes: true, entityRules: { where: { entityType }, select: { allowMultiple: true } } } } } } },
    })
    if (aliasRecord) { resolvedTagId = aliasRecord.tag.id; tag = aliasRecord.tag }
  }
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  if (tag.group.entityScopes.length > 0 && !tag.group.entityScopes.includes(entityType))
    return c.json({ code: 422, message: `分组「${tag.group.name}」不适用于实体类型 ${entityType}` }, 422)

  const effectiveAllowMultiple = tag.group.entityRules.length > 0 ? tag.group.entityRules[0].allowMultiple : tag.group.allowMultiple

  try {
    await prisma.$transaction(async (tx) => {
      await tx.registeredEntity.upsert({ where: { entityType_entityId: { entityType, entityId } }, create: { entityType, entityId }, update: {} })
      await tx.$queryRaw`SELECT 1 FROM "RegisteredEntity" WHERE "entityType" = ${entityType} AND "entityId" = ${entityId} FOR UPDATE`
      if (!effectiveAllowMultiple) {
        const existing = await tx.entityTag.findFirst({ where: { entityType, entityId, tag: { groupId: tag!.groupId }, status: 'active' } })
        if (existing) throw new ValidationError(422, `分组「${tag!.group.name}」不允许多选`)
      }
      await tx.entityTag.create({ data: { tagId: resolvedTagId, entityType, entityId, source, confidence, status } })
      if (status === 'pending') incAuditGauge()
    })
    return c.json({ code: 0, message: '打标成功' }, 200)
  } catch (error: unknown) {
    if (error instanceof ValidationError) return c.json({ code: error.statusCode, message: error.message }, error.statusCode as 422)
    if (isPrismaError(error, 'P2002')) return c.json({ code: 409, message: '标签已存在' }, 409)
    logger.error({ err: error, entityType, entityId, tagId }, 'POST entity tag error')
    throw error
  }
})

// ── PATCH /:entityType/:entityId/tags/:tagId ──────────────────────────────────
// 审核动作（通过 / 拒绝 / 重置 status，写 reviewer / reviewNote）属于 reviewer
// 专属职权，writer 不应越权改变 EntityTag.status。
const updateEntityTagRoute = createRoute({
  method: 'patch', path: '/{entityType}/{entityId}/tags/{tagId}',
  tags: ['实体标签'],
  summary: '审核标签状态',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('reviewer')] as const,
  request: {
    params: EntityTagWithTagIdParams,
    body: { content: { 'application/json': { schema: UpdateEntityTagBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    403: { content: { 'application/json': { schema: ApiError } }, description: '权限不足（需要 reviewer 或更高）' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '关联不存在' },
  },
})

taggingRouter.openapi(updateEntityTagRoute, async (c) => {
  const { entityType, entityId, tagId } = c.req.valid('param')
  const { status: newStatus, note } = c.req.valid('json')
  const reviewNote = typeof note === 'string' ? note.trim() || null : null
  const reviewerId = getTokenId(c)

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.entityTag.findUnique({ where: { tagId_entityType_entityId: { tagId, entityType, entityId } }, select: { status: true } })
      if (!current) throw Object.assign(new Error('not found'), { code: 'P2025' })

      await tx.entityTag.update({
        where: { tagId_entityType_entityId: { tagId, entityType, entityId } },
        data:  { status: newStatus as TagStatus, reviewedAt: new Date(), reviewerId, reviewNote, previousStatus: current.status },
      })

      if (current.status === 'pending' && newStatus !== 'pending') decAuditGauge()
      else if (current.status !== 'pending' && newStatus === 'pending') incAuditGauge()

      await tx.entityTagReview.create({ data: { tagId, entityType, entityId, reviewerId, fromStatus: current.status as TagStatus, toStatus: newStatus as TagStatus, note: reviewNote } })
    })
    return c.json({ code: 0, message: '更新成功' }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025') || (error instanceof Error && (error as NodeJS.ErrnoException).code === 'P2025'))
      return c.json({ code: 404, message: '关联不存在' }, 404)
    logger.error({ err: error, entityType, entityId, tagId }, 'PATCH entity tag error')
    throw error
  }
})

// ── GET /:entityType/:entityId/tags/:tagId/history ────────────────────────────
// 读操作：bearerAuth 已确保认证，所有角色（reader+）均可查看审核历史以保
// 障可观测性 / 透明度。无需额外 requireRole。
const getTagHistoryRoute = createRoute({
  method: 'get', path: '/{entityType}/{entityId}/tags/{tagId}/history',
  tags: ['实体标签'],
  summary: '获取审核历史时间线',
  request: { params: EntityTagWithTagIdParams },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(TagReviewSchema)) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '关联不存在' },
  },
})

taggingRouter.openapi(getTagHistoryRoute, async (c) => {
  const { entityType, entityId, tagId } = c.req.valid('param')
  const exists = await prisma.entityTag.findUnique({ where: { tagId_entityType_entityId: { tagId, entityType, entityId } }, select: { status: true } })
  if (!exists) return c.json({ code: 404, message: '关联不存在' }, 404)

  const reviews = await prisma.entityTagReview.findMany({
    where: { tagId, entityType, entityId },
    include: { reviewer: { select: { id: true, name: true, role: true } } },
    orderBy: { reviewedAt: 'asc' },
  })
  return c.json({ code: 0, data: reviews.map(r => ({ id: r.id, fromStatus: r.fromStatus as string, toStatus: r.toStatus as string, note: r.note, reviewedAt: r.reviewedAt.toISOString(), reviewer: r.reviewer ? { id: r.reviewer.id, name: r.reviewer.name, role: r.reviewer.role as string } : null })) }, 200)
})

// ── DELETE /:entityType/:entityId/tags/:tagId ─────────────────────────────────
// 摘标是打标的逆向，业务系统日常清理误打标记或回退标签，writer 即可。
const removeEntityTagRoute = createRoute({
  method: 'delete', path: '/{entityType}/{entityId}/tags/{tagId}',
  tags: ['实体标签'],
  summary: '摘标',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('writer')] as const,
  request: { params: EntityTagWithTagIdParams },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    403: { content: { 'application/json': { schema: ApiError } }, description: '权限不足' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '关联不存在' },
  },
})

taggingRouter.openapi(removeEntityTagRoute, async (c) => {
  const { entityType, entityId, tagId } = c.req.valid('param')
  try {
    const deleted = await prisma.entityTag.delete({ where: { tagId_entityType_entityId: { tagId, entityType, entityId } }, select: { status: true } })
    if (deleted.status === 'pending') decAuditGauge()
    return c.json({ code: 0, message: '摘标成功' }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025')) return c.json({ code: 404, message: '关联不存在' }, 404)
    logger.error({ err: error, entityType, entityId, tagId }, 'DELETE entity tag error')
    throw error
  }
})
