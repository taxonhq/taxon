import { Hono } from 'hono'
import type { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import { isPrismaError, ValidationError } from '../lib/errors.js'
import { validateTags } from '../lib/validate-tags.js'
import logger from '../lib/logger.js'

const VALID_SOURCES  = new Set(['manual', 'ai', 'system', 'import'])
const VALID_STATUSES = new Set(['active', 'pending', 'rejected'])

export const taggingRouter = new Hono()

// GET /:entityType/:entityId/tags — 实体已打标签列表
// ?status=all 返回所有状态；?status=pending 只返回待审核；默认只返回 active
taggingRouter.get('/:entityType/:entityId/tags', async (c) => {
  const { entityType, entityId } = c.req.param()
  const statusParam = c.req.query('status')

  const [entity, rows] = await Promise.all([
    prisma.registeredEntity.findUnique({
      where:  { entityType_entityId: { entityType, entityId } },
      select: { entityType: true },
    }),
    prisma.entityTag.findMany({
      where: {
        entityType,
        entityId,
        ...(statusParam && statusParam !== 'all'
          ? { status: statusParam }
          : statusParam !== 'all'
            ? { status: 'active' }
            : {}),
      },
      include: { tag: { include: { group: { select: { id: true, slug: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)

  return c.json({
    code: 0,
    data: rows.map((r: {
      source: string; confidence: number | null; status: string; createdAt: Date
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
taggingRouter.put('/:entityType/:entityId/tags', async (c) => {
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
  const source     = (body.source as string | undefined) ?? 'manual'
  const confidence = body.confidence as number | undefined
  const status     = (body.status as string | undefined) ?? (source === 'ai' ? 'pending' : 'active')

  if (!VALID_SOURCES.has(source))
    return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (source === 'ai' && confidence === undefined)
    return c.json({ code: 400, message: 'AI 来源必须提供 confidence（0~1）' }, 400)
  if (!VALID_STATUSES.has(status))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1))
    return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const validationError = await validateTags(tagIds, entityType)
  if (validationError) return c.json({ code: 422, message: validationError }, 422)

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 自动注册实体（upsert），业务方无需提前调用注册接口
      await tx.registeredEntity.upsert({
        where:  { entityType_entityId: { entityType, entityId } },
        create: { entityType, entityId },
        update: {},
      })
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
taggingRouter.post('/:entityType/:entityId/tags/:tagId', async (c) => {
  const { entityType, entityId, tagId } = c.req.param()

  let body: Record<string, unknown> = {}
  try { body = await c.req.json() } catch { /* 无 body 时使用默认值 */ }

  const source     = (body.source as string | undefined) ?? 'manual'
  const confidence = body.confidence as number | undefined
  const status     = (body.status as string | undefined) ?? (source === 'ai' ? 'pending' : 'active')

  if (!VALID_SOURCES.has(source))
    return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (source === 'ai' && confidence === undefined)
    return c.json({ code: 400, message: 'AI 来源必须提供 confidence（0~1）' }, 400)
  if (!VALID_STATUSES.has(status))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1))
    return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const tag = await prisma.tag.findUnique({
    where:  { id: tagId, deletedAt: null },
    select: {
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
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  if (tag.group.entityScopes.length > 0 && !tag.group.entityScopes.includes(entityType)) {
    return c.json({ code: 422, message: `分组「${tag.group.name}」不适用于实体类型 ${entityType}` }, 422)
  }

  const effectiveAllowMultiple =
    tag.group.entityRules.length > 0
      ? tag.group.entityRules[0].allowMultiple
      : tag.group.allowMultiple

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

      await tx.entityTag.create({ data: { tagId, entityType, entityId, source, confidence, status } })
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

// PATCH /:entityType/:entityId/tags/:tagId — 更新 status（审核流）
taggingRouter.patch('/:entityType/:entityId/tags/:tagId', async (c) => {
  const { entityType, entityId, tagId } = c.req.param()

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!body.status || !VALID_STATUSES.has(body.status as string))
    return c.json({ code: 400, message: `status 必填，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  try {
    await prisma.entityTag.update({
      where: { tagId_entityType_entityId: { tagId, entityType, entityId } },
      data:  { status: body.status as string },
    })
    return c.json({ code: 0, message: '更新成功' })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025'))
      return c.json({ code: 404, message: '关联不存在' }, 404)
    logger.error({ err: error, entityType, entityId, tagId }, 'PATCH entity tag error')
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

// DELETE /:entityType/:entityId/tags/:tagId — 摘标
taggingRouter.delete('/:entityType/:entityId/tags/:tagId', async (c) => {
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
