import { Hono } from 'hono'
import type { Prisma } from '@prisma/client'
import { TagSource, TagStatus } from '@prisma/client'
import prisma from '../lib/db.js'
import { isPrismaError, ValidationError } from '../lib/errors.js'
import { validateTags } from '../lib/validate-tags.js'
import logger from '../lib/logger.js'
import { requireRole, getTokenId } from '../middleware/auth.js'

const VALID_SOURCES  = new Set<string>(Object.values(TagSource))
const VALID_STATUSES = new Set<string>(Object.values(TagStatus))

export const taggingRouter = new Hono()

// GET /:entityType/:entityId/tags — 实体已打标签列表
// ?status=all 返回所有状态；?status=pending 只返回待审核；默认只返回 active
taggingRouter.get('/:entityType/:entityId/tags', async (c) => {
  const { entityType, entityId } = c.req.param()
  const statusParam = c.req.query('status')

  // 先确认实体存在，再查标签，避免并发注销时返回孤儿数据
  const entity = await prisma.registeredEntity.findUnique({
    where:  { entityType_entityId: { entityType, entityId } },
    select: { entityType: true },
  })
  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)

  const rows = await prisma.entityTag.findMany({
    where: {
      entityType,
      entityId,
      ...(statusParam && statusParam !== 'all'
        ? { status: statusParam as TagStatus }
        : statusParam !== 'all'
          ? { status: TagStatus.active }
          : {}),
    },
    include: { tag: { include: { group: { select: { id: true, slug: true, name: true } } } } },
    orderBy: { createdAt: 'asc' },
  })

  return c.json({
    code: 0,
    data: rows.map((r: {
      source: TagSource; confidence: number | null; status: TagStatus; createdAt: Date
      tag: { id: string; slug: string; name: string; groupId: string; group: object }
    }) => ({
      id:         r.tag.id,
      slug:       r.tag.slug,
      name:       r.tag.name,
      groupId:    r.tag.groupId,
      group:      r.tag.group,
      source:     r.source,
      confidence: r.confidence,
      status:     r.status,
      taggedAt:   r.createdAt,
    })),
  })
})

// PUT /:entityType/:entityId/tags — 全量替换实体标签
taggingRouter.put('/:entityType/:entityId/tags', requireRole('writer'), async (c) => {
  const { entityType, entityId } = c.req.param()

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (body.tagIds === undefined)
    return c.json({ code: 400, message: 'tagIds 为必填项' }, 400)
  if (!Array.isArray(body.tagIds))
    return c.json({ code: 400, message: 'tagIds 必须为数组' }, 400)
  if (body.tagIds.some((id: unknown) => typeof id !== 'string'))
    return c.json({ code: 400, message: 'tagIds 每个元素必须为字符串' }, 400)

  const tagIds: string[] = [...new Set(body.tagIds as string[])]
  const rawSource = (body.source as string | undefined) ?? 'manual'
  const confidence = body.confidence as number | undefined
  const rawStatus  = (body.status as string | undefined) ?? (rawSource === 'ai' ? 'pending' : 'active')

  if (!VALID_SOURCES.has(rawSource))
    return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (rawSource === 'ai' && confidence === undefined)
    return c.json({ code: 400, message: 'AI 来源必须提供 confidence（0~1）' }, 400)
  if (!VALID_STATUSES.has(rawStatus))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1))
    return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const source = rawSource as TagSource
  const status = rawStatus as TagStatus

  const validationError = await validateTags(tagIds, entityType)
  if (validationError) return c.json({ code: 422, message: validationError }, 422)

  try {
    await prisma.$transaction(async (tx) => {
      // 自动注册实体（upsert），业务方无需提前调用注册接口
      await tx.registeredEntity.upsert({
        where:  { entityType_entityId: { entityType, entityId } },
        create: { entityType, entityId },
        update: {},
      })

      // FOR UPDATE 锁住实体行，与并发 POST/PUT 串行化，
      // 防止 PUT(delete) → POST(insert single-tag) → PUT(insert) 的交错导致约束冲突
      await tx.$queryRaw`
        SELECT 1 FROM "RegisteredEntity"
        WHERE "entityType" = ${entityType} AND "entityId" = ${entityId}
        FOR UPDATE
      `

      await tx.entityTag.deleteMany({ where: { entityType, entityId } })
      if (tagIds.length > 0) {
        await tx.entityTag.createMany({
          data: tagIds.map(tagId => ({ tagId, entityType, entityId, source, confidence, status })),
        })
      }
    })
    return c.json({ code: 0, message: '更新成功' })
  } catch (error: unknown) {
    logger.error({ err: error, entityType, entityId }, 'PUT entity tags error')
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

// POST /:entityType/:entityId/tags/:tagId — 增量打标（单个）
taggingRouter.post('/:entityType/:entityId/tags/:tagId', requireRole('writer'), async (c) => {
  const { entityType, entityId, tagId } = c.req.param()

  let body: Record<string, unknown> = {}
  try { body = await c.req.json() } catch { /* 无 body 时使用默认值 */ }

  const rawSource  = (body.source as string | undefined) ?? 'manual'
  const confidence = body.confidence as number | undefined
  const rawStatus  = (body.status as string | undefined) ?? (rawSource === 'ai' ? 'pending' : 'active')

  if (!VALID_SOURCES.has(rawSource))
    return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (rawSource === 'ai' && confidence === undefined)
    return c.json({ code: 400, message: 'AI 来源必须提供 confidence（0~1）' }, 400)
  if (!VALID_STATUSES.has(rawStatus))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1))
    return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const source = rawSource as TagSource
  const status = rawStatus as TagStatus

  // tagId 参数支持传真实 ID 或 alias（自动 resolve）
  let resolvedTagId = tagId
  let tag = await prisma.tag.findUnique({
    where:  { id: tagId, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      group: {
        select: {
          name: true,
          allowMultiple: true,
          entityScopes: true,
          entityRules: { where: { entityType }, select: { allowMultiple: true } },
        },
      },
    },
  })

  // 未按 ID 找到时，尝试按 alias 解析
  if (!tag) {
    const aliasRecord = await prisma.tagAlias.findFirst({
      where: { alias: tagId, tag: { deletedAt: null } },
      include: {
        tag: {
          select: {
            id: true,
            groupId: true,
            group: {
              select: {
                name: true,
                allowMultiple: true,
                entityScopes: true,
                entityRules: { where: { entityType }, select: { allowMultiple: true } },
              },
            },
          },
        },
      },
    })
    if (aliasRecord) {
      resolvedTagId = aliasRecord.tag.id
      tag = aliasRecord.tag
    }
  }

  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  if (tag.group.entityScopes.length > 0 && !tag.group.entityScopes.includes(entityType)) {
    return c.json({ code: 422, message: `分组「${tag.group.name}」不适用于实体类型 ${entityType}` }, 422)
  }

  const effectiveAllowMultiple =
    tag.group.entityRules.length > 0
      ? tag.group.entityRules[0].allowMultiple
      : tag.group.allowMultiple

  try {
    await prisma.$transaction(async (tx) => {
      // 自动注册实体
      await tx.registeredEntity.upsert({
        where:  { entityType_entityId: { entityType, entityId } },
        create: { entityType, entityId },
        update: {},
      })

      // FOR UPDATE 锁住实体行，防止并发请求绕过 allowMultiple 检查
      await tx.$queryRaw`
        SELECT 1 FROM "RegisteredEntity"
        WHERE "entityType" = ${entityType} AND "entityId" = ${entityId}
        FOR UPDATE
      `

      if (!effectiveAllowMultiple) {
        const existing = await tx.entityTag.findFirst({
          where: { entityType, entityId, tag: { groupId: tag.groupId }, status: 'active' },
        })
        if (existing) throw new ValidationError(422, `分组「${tag.group.name}」不允许多选`)
      }

      await tx.entityTag.create({ data: { tagId: resolvedTagId, entityType, entityId, source, confidence, status } })
    })
    return c.json({ code: 0, message: '打标成功' })
  } catch (error: unknown) {
    if (error instanceof ValidationError)
      return c.json({ code: error.statusCode, message: error.message }, error.statusCode as 422)
    if (isPrismaError(error, 'P2002'))
      return c.json({ code: 409, message: '标签已存在' }, 409)
    logger.error({ err: error, entityType, entityId, tagId }, 'POST entity tag error')
    return c.json({ code: 500, message: '打标失败' }, 500)
  }
})

// PATCH /:entityType/:entityId/tags/:tagId — 更新 status（审核流），写入历史记录
taggingRouter.patch('/:entityType/:entityId/tags/:tagId', requireRole('reviewer'), async (c) => {
  const { entityType, entityId, tagId } = c.req.param()

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!body.status || !VALID_STATUSES.has(body.status as string))
    return c.json({ code: 400, message: `status 必填，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  const newStatus  = body.status as TagStatus
  const note       = typeof body.note === 'string' ? body.note.trim() || null : null
  const reviewerId = getTokenId(c)

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.entityTag.findUnique({
        where:  { tagId_entityType_entityId: { tagId, entityType, entityId } },
        select: { status: true },
      })
      if (!current) throw Object.assign(new Error('not found'), { code: 'P2025' })

      await tx.entityTag.update({
        where: { tagId_entityType_entityId: { tagId, entityType, entityId } },
        data:  {
          status:         newStatus,
          reviewedAt:     new Date(),
          reviewerId,
          reviewNote:     note,
          previousStatus: current.status,
        },
      })

      await tx.entityTagReview.create({
        data: {
          tagId, entityType, entityId,
          reviewerId,
          fromStatus: current.status,
          toStatus:   newStatus,
          note,
        },
      })
    })
    return c.json({ code: 0, message: '更新成功' })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025') || (error instanceof Error && (error as NodeJS.ErrnoException).code === 'P2025'))
      return c.json({ code: 404, message: '关联不存在' }, 404)
    logger.error({ err: error, entityType, entityId, tagId }, 'PATCH entity tag error')
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

// GET /:entityType/:entityId/tags/:tagId/history — 审核历史时间线
taggingRouter.get('/:entityType/:entityId/tags/:tagId/history', async (c) => {
  const { entityType, entityId, tagId } = c.req.param()

  const exists = await prisma.entityTag.findUnique({
    where:  { tagId_entityType_entityId: { tagId, entityType, entityId } },
    select: { status: true },
  })
  if (!exists) return c.json({ code: 404, message: '关联不存在' }, 404)

  const reviews = await prisma.entityTagReview.findMany({
    where:   { tagId, entityType, entityId },
    include: { reviewer: { select: { id: true, name: true, role: true } } },
    orderBy: { reviewedAt: 'asc' },
  })

  return c.json({
    code: 0,
    data: reviews.map(r => ({
      id:           r.id,
      fromStatus:   r.fromStatus,
      toStatus:     r.toStatus,
      note:         r.note,
      reviewedAt:   r.reviewedAt,
      reviewer:     r.reviewer ? { id: r.reviewer.id, name: r.reviewer.name, role: r.reviewer.role } : null,
    })),
  })
})

// DELETE /:entityType/:entityId/tags/:tagId — 摘标
taggingRouter.delete('/:entityType/:entityId/tags/:tagId', requireRole('writer'), async (c) => {
  const { entityType, entityId, tagId } = c.req.param()
  try {
    await prisma.entityTag.delete({
      where: { tagId_entityType_entityId: { tagId, entityType, entityId } },
    })
    return c.json({ code: 0, message: '摘标成功' })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025'))
      return c.json({ code: 404, message: '关联不存在' }, 404)
    logger.error({ err: error, entityType, entityId, tagId }, 'DELETE entity tag error')
    return c.json({ code: 500, message: '摘标失败' }, 500)
  }
})
