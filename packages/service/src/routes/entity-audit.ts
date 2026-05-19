import { Hono } from 'hono'
import { TagStatus } from '@prisma/client'
import prisma from '../lib/db.js'

const VALID_STATUSES = new Set<string>(Object.values(TagStatus))

export const auditRouter = new Hono()

// GET /audit — 审核队列，支持 status / entityType / 分页过滤
auditRouter.get('/audit', async (c) => {
  const statusParam = c.req.query('status') || 'pending'
  const entityType  = c.req.query('entityType')
  const page        = Math.max(1, parseInt(c.req.query('page') || '1'))
  const pageSize    = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
  const skip        = (page - 1) * pageSize

  if (!VALID_STATUSES.has(statusParam))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  const where = {
    status: statusParam as TagStatus,
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

// GET /:entityType — 两种模式：
//   • 带 ?tagId= 或 ?q= → 按标签过滤，返回 { entityIds: [] }（调用方查询用）
//   • 其余情况          → 分页列出已注册实体，返回 { items, total, page, pageSize }
auditRouter.get('/:entityType', async (c) => {
  const { entityType } = c.req.param()
  const tagIds = c.req.queries('tagId') ?? []
  const q      = c.req.query('q')

  // ── 标签过滤模式 ──────────────────────────────────────────────
  if (tagIds.length > 0 || q) {
    let entityIds: string[] | undefined

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

    if (q) {
      const matchedTags = await prisma.tag.findMany({
        where: { name: { contains: q }, deletedAt: null },
        select: { id: true },
      })
      if (matchedTags.length === 0) return c.json({ code: 0, data: { entityIds: [] } })

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

    return c.json({ code: 0, data: { entityIds } })
  }

  // ── 分页列表模式 ──────────────────────────────────────────────
  const search   = c.req.query('search')?.trim() || undefined
  const page     = Math.max(1, parseInt(c.req.query('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
  const skip     = (page - 1) * pageSize

  const where = {
    entityType,
    ...(search ? { entityId: { contains: search } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.registeredEntity.findMany({
      where,
      select:  { entityType: true, entityId: true, registeredAt: true },
      orderBy: { registeredAt: 'desc' },
      skip,
      take:    pageSize,
    }),
    prisma.registeredEntity.count({ where }),
  ])

  return c.json({ code: 0, data: { items, total, page, pageSize } })
})
