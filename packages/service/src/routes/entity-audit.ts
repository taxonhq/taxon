import { Hono } from 'hono'
import { Prisma, TagStatus } from '@prisma/client'
import type { Prisma as PrismaTypes } from '@prisma/client'
import prisma from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'

const VALID_STATUSES = new Set<string>(Object.values(TagStatus))

export const auditRouter = new Hono()

// GET /audit — 审核队列，支持 status / entityType / reviewerId / from / to / 分页过滤
auditRouter.get('/audit', requireRole('reviewer'), async (c) => {
  const statusParam  = c.req.query('status') || 'pending'
  const entityType   = c.req.query('entityType')
  const reviewerId   = c.req.query('reviewerId')   // 过滤最后一次审核者
  const from         = c.req.query('from')          // ISO 日期，reviewedAt >=
  const to           = c.req.query('to')            // ISO 日期，reviewedAt <=
  const page         = Math.max(1, parseInt(c.req.query('page') || '1'))
  const pageSize     = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
  const skip         = (page - 1) * pageSize

  if (!VALID_STATUSES.has(statusParam))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  const where: PrismaTypes.EntityTagWhereInput = {
    status: statusParam as TagStatus,
    tag: { deletedAt: null },
    ...(entityType ? { entityType }   : {}),
    ...(reviewerId ? { reviewerId }   : {}),
    ...(from || to ? {
      reviewedAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      },
    } : {}),
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

  // 若有 reviewerId，批量查 token 名称（减少后续 N+1）
  const reviewerIds = [...new Set(items.map((r: { reviewerId: string | null }) => r.reviewerId).filter(Boolean))] as string[]
  const tokenMap = new Map<string, string>()
  if (reviewerIds.length > 0) {
    const tokens = await prisma.apiToken.findMany({
      where: { id: { in: reviewerIds } },
      select: { id: true, name: true },
    })
    tokens.forEach((t: { id: string; name: string }) => tokenMap.set(t.id, t.name))
  }

  return c.json({
    code: 0,
    data: {
      items: items.map((r: {
        tagId: string; entityType: string; entityId: string
        source: string; confidence: number | null; status: string; createdAt: Date
        reviewerId: string | null; reviewNote: string | null; reviewedAt: Date | null
        tag: { id: string; slug: string; name: string; group: object }
      }) => ({
        tagId:        r.tagId,
        entityType:   r.entityType,
        entityId:     r.entityId,
        source:       r.source,
        confidence:   r.confidence,
        status:       r.status,
        taggedAt:     r.createdAt,
        reviewedAt:   r.reviewedAt,
        reviewNote:   r.reviewNote,
        reviewerName: r.reviewerId ? (tokenMap.get(r.reviewerId) ?? null) : null,
        tag:          r.tag,
      })),
      total,
      page,
      pageSize,
    },
  })
})

// GET /:entityType — 两种模式：
//   • 带 ?tagId= 或 ?q= → 标签过滤，返回 { items, total, page, pageSize }（分页）
//   • 其余情况          → 分页列出已注册实体，返回 { items, total, page, pageSize }
auditRouter.get('/:entityType', async (c) => {
  const { entityType } = c.req.param()
  const tagIds = c.req.queries('tagId') ?? []
  const q      = c.req.query('q')

  // ── 标签过滤模式（分页） ───────────────────────────────────────
  if (tagIds.length > 0 || q) {
    const page     = Math.max(1, parseInt(c.req.query('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
    const offset   = (page - 1) * pageSize

    // 实体必须持有所有指定 tagId（ALL 语义）
    const allTagsClause = tagIds.length > 0
      ? Prisma.sql`AND "entityId" IN (
          SELECT "entityId" FROM "EntityTag"
          WHERE "entityType" = ${entityType}
            AND "tagId" = ANY(${tagIds}::text[])
            AND "status" = 'active'
          GROUP BY "entityId"
          HAVING COUNT(DISTINCT "tagId") = ${tagIds.length}
        )`
      : Prisma.empty

    // 实体必须持有至少一个名称含 q 的标签
    let nameClause = Prisma.empty
    if (q) {
      const matched = await prisma.tag.findMany({
        where: { name: { contains: q }, deletedAt: null },
        select: { id: true },
      })
      if (matched.length === 0)
        return c.json({ code: 0, data: { items: [], total: 0, page, pageSize } })
      const qIds = matched.map((t: { id: string }) => t.id)
      nameClause = Prisma.sql`AND "tagId" = ANY(${qIds}::text[])`
    }

    type Row      = { entityId: string }
    type CountRow = { count: bigint }

    const base = Prisma.sql`
      FROM "EntityTag"
      WHERE "entityType" = ${entityType} AND "status" = 'active'
        ${nameClause}
        ${allTagsClause}
    `

    const [rows, [{ count }]] = await Promise.all([
      prisma.$queryRaw<Row[]>(
        Prisma.sql`SELECT DISTINCT "entityId" ${base} ORDER BY "entityId" LIMIT ${pageSize} OFFSET ${offset}`
      ),
      prisma.$queryRaw<CountRow[]>(
        Prisma.sql`SELECT COUNT(DISTINCT "entityId") AS count ${base}`
      ),
    ])

    const total = Number(count)
    const items = rows.map((r: Row) => ({ entityType, entityId: r.entityId }))
    return c.json({ code: 0, data: { items, total, page, pageSize } })
  }

  // ── 分页列表模式 ──────────────────────────────────────────────
  const search    = c.req.query('search')?.trim() || undefined
  const page      = Math.max(1, parseInt(c.req.query('page') || '1'))
  const pageSize  = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
  const withTags  = c.req.query('withTags') === 'true'
  const skip      = (page - 1) * pageSize

  const where = {
    entityType,
    ...(search ? { entityId: { contains: search } } : {}),
  }

  // withTags=true：一次性 include 每个实体的 active 标签，避免 N+1
  // （历史上 console 列表页对 20 条实体并发发 20 次 GET .../tags 请求）
  const total = await prisma.registeredEntity.count({ where })

  if (withTags) {
    const rows = await prisma.registeredEntity.findMany({
      where,
      select: {
        entityType:   true,
        entityId:     true,
        registeredAt: true,
        entityTags: {
          where: { status: 'active', tag: { deletedAt: null } },
          select: {
            tagId:      true,
            source:     true,
            confidence: true,
            status:     true,
            createdAt:  true,
            tag: {
              select: {
                id: true, slug: true, name: true, groupId: true,
                group: { select: { id: true, slug: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { registeredAt: 'desc' },
      skip,
      take: pageSize,
    })

    // 平铺 entityTags 为 tags（与 GET /:type/:id/tags 字段一致）
    const items = rows.map(r => ({
      entityType:   r.entityType,
      entityId:     r.entityId,
      registeredAt: r.registeredAt,
      tags: r.entityTags.map(et => ({
        id:         et.tag.id,
        slug:       et.tag.slug,
        name:       et.tag.name,
        groupId:    et.tag.groupId,
        group:      et.tag.group,
        source:     et.source,
        confidence: et.confidence,
        status:     et.status,
        taggedAt:   et.createdAt,
      })),
    }))

    return c.json({ code: 0, data: { items, total, page, pageSize } })
  }

  const items = await prisma.registeredEntity.findMany({
    where,
    select:  { entityType: true, entityId: true, registeredAt: true },
    orderBy: { registeredAt: 'desc' },
    skip,
    take:    pageSize,
  })

  return c.json({ code: 0, data: { items, total, page, pageSize } })
})
