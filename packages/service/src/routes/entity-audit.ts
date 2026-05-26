import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { Prisma, TagStatus } from '@prisma/client'
import type { Prisma as PrismaTypes } from '@prisma/client'
import prisma from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'
import {
  AuditItemSchema, RegisteredEntitySchema,
  ApiError, okData, Paginated, PaginationQuery,
} from '../lib/schemas.js'

const VALID_STATUSES = new Set<string>(Object.values(TagStatus))

export const auditRouter = new OpenAPIHono()

// ── GET /audit ────────────────────────────────────────────────────────────────
const listAuditRoute = createRoute({
  method: 'get', path: '/audit',
  tags: ['实体标签'],
  summary: '审核队列',
  security: [{ BearerAuth: [] }],
  request: {
    query: PaginationQuery.extend({
      status:     z.string().optional().openapi({ description: '状态过滤（pending/active/rejected）' }),
      entityType: z.string().optional(),
      reviewerId: z.string().optional(),
      from:       z.string().optional().openapi({ description: 'ISO 日期，reviewedAt >=' }),
      to:         z.string().optional().openapi({ description: 'ISO 日期，reviewedAt <=' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(Paginated(AuditItemSchema)) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
})

auditRouter.use('/audit', requireRole('reviewer'))
auditRouter.openapi(listAuditRoute, async (c) => {
  const statusParam  = c.req.query('status') || 'pending'
  const entityType   = c.req.query('entityType')
  const reviewerId   = c.req.query('reviewerId')
  const from         = c.req.query('from')
  const to           = c.req.query('to')
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
    ...(from || to ? { reviewedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.entityTag.findMany({
      where,
      include: { tag: { select: { id: true, slug: true, name: true, group: { select: { id: true, slug: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip, take: pageSize,
    }),
    prisma.entityTag.count({ where }),
  ])

  const reviewerIds = [...new Set(items.map(r => r.reviewerId).filter(Boolean))] as string[]
  const tokenMap = new Map<string, string>()
  if (reviewerIds.length > 0) {
    const tokens = await prisma.apiToken.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
    tokens.forEach(t => tokenMap.set(t.id, t.name))
  }

  return c.json({
    code: 0,
    data: {
      items: items.map(r => ({
        tagId: r.tagId, entityType: r.entityType, entityId: r.entityId,
        source: r.source as string, confidence: r.confidence, status: r.status as string,
        taggedAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewNote: r.reviewNote,
        reviewerName: r.reviewerId ? (tokenMap.get(r.reviewerId) ?? null) : null,
        tag: r.tag,
      })),
      total, page, pageSize,
    },
  }, 200)
})

// ── GET /:entityType ──────────────────────────────────────────────────────────
const listEntitiesRoute = createRoute({
  method: 'get', path: '/{entityType}',
  tags: ['实体'],
  summary: '列出实体（支持标签过滤）',
  request: {
    params: z.object({ entityType: z.string().min(1) }),
    query: PaginationQuery.extend({
      // tagId 支持 ?tagId=A 或 ?tagId=A&tagId=B 两种形式 — Hono 对重复 query
      // 参数会给 Zod 一个 string[]，单值情况下是 string。
      tagId:    z.union([z.string(), z.array(z.string())]).optional().openapi({ description: '标签 ID 过滤（可多个，AND 语义）' }),
      q:        z.string().optional().openapi({ description: '按标签名称模糊过滤' }),
      search:   z.string().optional().openapi({ description: '按 entityId 模糊搜索' }),
      withTags: z.enum(['true', 'false']).optional(),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(Paginated(RegisteredEntitySchema)) } }, description: '成功' },
  },
})

auditRouter.openapi(listEntitiesRoute, async (c) => {
  const { entityType } = c.req.valid('param')
  const tagIds = c.req.queries('tagId') ?? []
  const q      = c.req.query('q')

  // ── 标签过滤模式 ────────────────────────────────────────────────
  if (tagIds.length > 0 || q) {
    const page     = Math.max(1, parseInt(c.req.query('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
    const offset   = (page - 1) * pageSize

    const allTagsClause = tagIds.length > 0
      ? Prisma.sql`AND "entityId" IN (
          SELECT "entityId" FROM "EntityTag"
          WHERE "entityType" = ${entityType} AND "tagId" = ANY(${tagIds}::text[]) AND "status" = 'active'
          GROUP BY "entityId" HAVING COUNT(DISTINCT "tagId") = ${tagIds.length}
        )`
      : Prisma.empty

    let nameClause = Prisma.empty
    if (q) {
      const matched = await prisma.tag.findMany({ where: { name: { contains: q }, deletedAt: null }, select: { id: true } })
      if (matched.length === 0) return c.json({ code: 0, data: { items: [], total: 0, page, pageSize } }, 200)
      const qIds = matched.map(t => t.id)
      nameClause = Prisma.sql`AND "tagId" = ANY(${qIds}::text[])`
    }

    type Row = { entityId: string }; type CountRow = { count: bigint }
    const base = Prisma.sql`FROM "EntityTag" WHERE "entityType" = ${entityType} AND "status" = 'active' ${nameClause} ${allTagsClause}`
    const [rows, [{ count }]] = await Promise.all([
      prisma.$queryRaw<Row[]>(Prisma.sql`SELECT DISTINCT "entityId" ${base} ORDER BY "entityId" LIMIT ${pageSize} OFFSET ${offset}`),
      prisma.$queryRaw<CountRow[]>(Prisma.sql`SELECT COUNT(DISTINCT "entityId") AS count ${base}`),
    ])
    return c.json({ code: 0, data: { items: rows.map(r => ({ entityType, entityId: r.entityId })), total: Number(count), page, pageSize } }, 200)
  }

  // ── 分页列表模式 ────────────────────────────────────────────────
  const search   = c.req.query('search')?.trim() || undefined
  const page     = Math.max(1, parseInt(c.req.query('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '20')))
  const withTags = c.req.query('withTags') === 'true'
  const skip     = (page - 1) * pageSize
  const where    = { entityType, ...(search ? { entityId: { contains: search } } : {}) }
  const total    = await prisma.registeredEntity.count({ where })

  if (withTags) {
    const rows = await prisma.registeredEntity.findMany({
      where,
      select: {
        entityType: true, entityId: true, registeredAt: true,
        entityTags: {
          where: { status: 'active', tag: { deletedAt: null } },
          select: { tagId: true, source: true, confidence: true, status: true, createdAt: true, tag: { select: { id: true, slug: true, name: true, groupId: true, group: { select: { id: true, slug: true, name: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { registeredAt: 'desc' }, skip, take: pageSize,
    })
    const items = rows.map(r => ({
      entityType: r.entityType, entityId: r.entityId, registeredAt: r.registeredAt.toISOString(),
      tags: r.entityTags.map(et => ({ id: et.tag.id, slug: et.tag.slug, name: et.tag.name, groupId: et.tag.groupId, group: et.tag.group, source: et.source, confidence: et.confidence, status: et.status as string, taggedAt: et.createdAt.toISOString() })),
    }))
    return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
  }

  const rows = await prisma.registeredEntity.findMany({ where, select: { entityType: true, entityId: true, registeredAt: true }, orderBy: { registeredAt: 'desc' }, skip, take: pageSize })
  const items = rows.map(r => ({ entityType: r.entityType, entityId: r.entityId, registeredAt: r.registeredAt.toISOString() }))
  return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
})
