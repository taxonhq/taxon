import { Hono } from 'hono'
import type { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import { isPrismaError, ValidationError } from '../lib/errors.js'

const entities = new Hono()

// 有效枚举值
const VALID_SOURCES = new Set(['manual', 'ai', 'system', 'import'])
const VALID_STATUSES = new Set(['active', 'pending', 'rejected'])

// ── validateTags ──────────────────────────────────────────────
// 校验 tagIds：存在性（排除软删除）、entityScopes 匹配、allowMultiple 约束
// allowMultiple 优先使用 TagGroupEntityRule 的实体类型级覆盖，回退到分组默认值
async function validateTags(tagIds: string[], entityType: string): Promise<string | null> {
  if (tagIds.length === 0) return null

  const tags = await prisma.tag.findMany({
    where: { id: { in: tagIds }, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      group: {
        select: {
          name: true,
          allowMultiple: true,
          entityScopes: true,
          entityRules: {
            where: { entityType },
            select: { allowMultiple: true },
          },
        },
      },
    },
  })

  if (tags.length !== tagIds.length) {
    const foundIds = new Set(tags.map((t: { id: string }) => t.id))
    const missing = tagIds.filter(id => !foundIds.has(id))
    return `标签不存在: ${missing.join(', ')}`
  }

  for (const tag of tags) {
    if (tag.group.entityScopes.length > 0 && !tag.group.entityScopes.includes(entityType)) {
      return `分组「${tag.group.name}」不适用于实体类型 ${entityType}`
    }
  }

  // allowMultiple 约束：实体类型规则优先于分组默认值
  type GroupEntry = { name: string; allowMultiple: boolean; count: number }
  const groupCounts = new Map<string, GroupEntry>()
  for (const tag of tags) {
    const effectiveAllowMultiple =
      tag.group.entityRules.length > 0
        ? tag.group.entityRules[0].allowMultiple
        : tag.group.allowMultiple

    const entry = groupCounts.get(tag.groupId)
    if (entry) {
      entry.count++
    } else {
      groupCounts.set(tag.groupId, { name: tag.group.name, allowMultiple: effectiveAllowMultiple, count: 1 })
    }
  }
  for (const [, { name, allowMultiple, count }] of groupCounts) {
    if (!allowMultiple && count > 1) return `分组「${name}」不允许多选`
  }

  return null
}

/* ── 实体注册 ─────────────────────────────────────────────────── */

entities.post('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  try {
    await prisma.registeredEntity.upsert({
      where:  { entityType_entityId: { entityType, entityId } },
      create: { entityType, entityId },
      update: {},
    })
    return c.json({ code: 0, message: '注册成功' })
  } catch (error: unknown) {
    console.error('Register entity error:', error)
    return c.json({ code: 500, message: '注册失败' }, 500)
  }
})

entities.delete('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  try {
    await prisma.registeredEntity.delete({
      where: { entityType_entityId: { entityType, entityId } },
    })
    return c.json({ code: 0, message: '注销成功' })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025'))
      return c.json({ code: 404, message: '实体未注册' }, 404)
    console.error('Unregister entity error:', error)
    return c.json({ code: 500, message: '注销失败' }, 500)
  }
})

entities.get('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  const entity = await prisma.registeredEntity.findUnique({
    where:  { entityType_entityId: { entityType, entityId } },
    select: { entityType: true, entityId: true, registeredAt: true },
  })
  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)
  return c.json({ code: 0, data: entity })
})

// 审核队列：列出待审核（或指定状态）的 EntityTag 记录，分页
// ?status=pending（默认）| active | rejected
// ?entityType=dish  （可选，按实体类型过滤）
// ?page=1 &pageSize=20
entities.get('/audit', async (c) => {
  const statusParam  = c.req.query('status') || 'pending'
  const entityType   = c.req.query('entityType')
  const page         = Math.max(1, parseInt(c.req.query('page') || '1'))
  const pageSize     = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
  const skip         = (page - 1) * pageSize

  if (!VALID_STATUSES.has(statusParam))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  const where = {
    status: statusParam,
    ...(entityType ? { entityType } : {}),
    tag: { deletedAt: null },
  }

  const [items, total] = await Promise.all([
    prisma.entityTag.findMany({
      where,
      include: {
        tag: {
          select: {
            id: true, slug: true, name: true,
            group: { select: { id: true, slug: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.entityTag.count({ where }),
  ])

  return c.json({
    code: 0,
    data: {
      items: items.map((r: {
        tagId: string; entityType: string; entityId: string
        source: string; confidence: number | null; status: string; createdAt: Date
        tag: { id: string; slug: string; name: string; group: object }
      }) => ({
        tagId:      r.tagId,
        entityType: r.entityType,
        entityId:   r.entityId,
        source:     r.source,
        confidence: r.confidence,
        status:     r.status,
        taggedAt:   r.createdAt,
        tag:        r.tag,
      })),
      total,
      page,
      pageSize,
    },
  })
})

// 按实体类型列出已注册的实体 ID，支持：
//   tagId（可多次，AND 语义：同时持有所有指定标签）
//   q    （标签名模糊搜索，与 tagId 取交集）
entities.get('/:entityType', async (c) => {
  const { entityType } = c.req.param()
  const tagIds = c.req.queries('tagId') ?? []
  const q      = c.req.query('q')

  let entityIds: string[] | undefined

  // tagId AND 语义：通过 GROUP BY + HAVING COUNT 实现一次查询
  if (tagIds.length > 0) {
    type Row = { entityId: string }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT "entityId"
      FROM "EntityTag"
      WHERE "entityType" = ${entityType}
        AND "tagId" = ANY(${tagIds}::text[])
        AND "status" = 'active'
      GROUP BY "entityId"
      HAVING COUNT(DISTINCT "tagId") = ${tagIds.length}
    `
    entityIds = rows.map((r: Row) => r.entityId)
    if (entityIds.length === 0) return c.json({ code: 0, data: { entityIds: [] } })
  }

  // q：标签名模糊搜索，与已有结果取交集
  if (q) {
    const matchedTags = await prisma.tag.findMany({
      where: { name: { contains: q }, deletedAt: null },
      select: { id: true },
    })
    if (matchedTags.length === 0) {
      return c.json({ code: 0, data: { entityIds: [] } })
    }
    const matchedTagIds = matchedTags.map((t: { id: string }) => t.id)
    const rows = await prisma.entityTag.findMany({
      where: {
        entityType,
        tagId: { in: matchedTagIds },
        status: 'active',
        ...(entityIds ? { entityId: { in: entityIds } } : {}),
      },
      select:   { entityId: true },
      distinct: ['entityId'],
    })
    entityIds = rows.map((r: { entityId: string }) => r.entityId)
    if (entityIds.length === 0) return c.json({ code: 0, data: { entityIds: [] } })
  }

  if (entityIds !== undefined) {
    return c.json({ code: 0, data: { entityIds } })
  }

  // 无过滤：返回所有已注册的实体 ID（最多 1000 条）
  const rows = await prisma.registeredEntity.findMany({
    where:   { entityType },
    select:  { entityId: true },
    orderBy: { registeredAt: 'asc' },
    take:    1000,
  })
  return c.json({ code: 0, data: { entityIds: rows.map((r: { entityId: string }) => r.entityId) } })
})

/* ── 实体标签操作 ─────────────────────────────────────────────── */

// 查询实体的标签，默认只返回 active 状态
// ?status=all 返回所有状态；?status=pending 只返回待审核
entities.get('/:entityType/:entityId/tags', async (c) => {
  const { entityType, entityId } = c.req.param()
  const statusParam = c.req.query('status') // 'active' | 'pending' | 'rejected' | 'all'

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

// 全量替换实体的标签
// body: { tagIds, source?, confidence?, status? }
// source 默认 manual；status 默认随 source 决定（ai → pending，其余 → active）
entities.put('/:entityType/:entityId/tags', async (c) => {
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
  if (!VALID_STATUSES.has(status))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1))
    return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const [entity, validationError] = await Promise.all([
    prisma.registeredEntity.findUnique({
      where:  { entityType_entityId: { entityType, entityId } },
      select: { entityType: true },
    }),
    validateTags(tagIds, entityType),
  ])

  if (!entity)         return c.json({ code: 404, message: '实体未注册' }, 404)
  if (validationError) return c.json({ code: 422, message: validationError }, 422)

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.entityTag.deleteMany({ where: { entityType, entityId } })
      if (tagIds.length > 0) {
        await tx.entityTag.createMany({
          data: tagIds.map(tagId => ({ tagId, entityType, entityId, source, confidence, status })),
        })
      }
    })
    return c.json({ code: 0, message: '更新成功' })
  } catch (error: unknown) {
    console.error('PUT entity tags error:', error)
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

// 增量打标（单个标签）
// body: { source?, confidence?, status? }
entities.post('/:entityType/:entityId/tags/:tagId', async (c) => {
  const { entityType, entityId, tagId } = c.req.param()

  let body: Record<string, unknown> = {}
  try { body = await c.req.json() } catch { /* 无 body 时使用默认值 */ }

  const source     = (body.source as string | undefined) ?? 'manual'
  const confidence = body.confidence as number | undefined
  const status     = (body.status as string | undefined) ?? (source === 'ai' ? 'pending' : 'active')

  if (!VALID_SOURCES.has(source))
    return c.json({ code: 400, message: `source 无效，可选值：${[...VALID_SOURCES].join(', ')}` }, 400)
  if (!VALID_STATUSES.has(status))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1))
    return c.json({ code: 400, message: 'confidence 必须为 0~1 的数值' }, 400)

  const [entity, tag] = await Promise.all([
    prisma.registeredEntity.findUnique({
      where:  { entityType_entityId: { entityType, entityId } },
      select: { entityType: true },
    }),
    prisma.tag.findUnique({
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
    }),
  ])

  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)
  if (!tag)    return c.json({ code: 404, message: '标签不存在' }, 404)

  if (tag.group.entityScopes.length > 0 && !tag.group.entityScopes.includes(entityType)) {
    return c.json({ code: 422, message: `分组「${tag.group.name}」不适用于实体类型 ${entityType}` }, 422)
  }

  // allowMultiple 检查在事务内执行，避免并发竞态
  const effectiveAllowMultiple =
    tag.group.entityRules.length > 0
      ? tag.group.entityRules[0].allowMultiple
      : tag.group.allowMultiple

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
    console.error('POST entity tag error:', error)
    return c.json({ code: 500, message: '打标失败' }, 500)
  }
})

// 更新单条 EntityTag 的 status（用于审核流：pending → active / rejected）
entities.patch('/:entityType/:entityId/tags/:tagId', async (c) => {
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
    console.error('PATCH entity tag error:', error)
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

// 摘标（单个）
entities.delete('/:entityType/:entityId/tags/:tagId', async (c) => {
  const { entityType, entityId, tagId } = c.req.param()
  try {
    await prisma.entityTag.delete({
      where: { tagId_entityType_entityId: { tagId, entityType, entityId } },
    })
    return c.json({ code: 0, message: '摘标成功' })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025'))
      return c.json({ code: 404, message: '关联不存在' }, 404)
    console.error('DELETE entity tag error:', error)
    return c.json({ code: 500, message: '摘标失败' }, 500)
  }
})

export { entities }
