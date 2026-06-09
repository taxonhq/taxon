import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/router.js'
import { Prisma, TagStatus } from '@prisma/client'
import type { Prisma as PrismaTypes } from '@prisma/client'
import prisma from '../lib/db.js'
import { requireRole, getTokenId } from '../middleware/auth.js'
import { parsePagination, parseBool } from '../lib/pagination.js'
import { incAuditGauge, decAuditGauge } from '../lib/metrics.js'
import {
  AuditItemSchema, RegisteredEntitySchema,
  ApiError, OkMessage, okData, Paginated, PaginationQuery,
} from '../lib/schemas.js'

const VALID_STATUSES = new Set<string>(Object.values(TagStatus))

export const auditRouter = createRouter()

// ── GET /audit ────────────────────────────────────────────────────────────────
const listAuditRoute = createRoute({
  method: 'get', path: '/audit',
  tags: ['实体标签'],
  summary: '审核队列',
  security: [{ BearerAuth: [] }],
  request: {
    query: PaginationQuery.extend({
      status:        z.enum(['pending', 'active', 'rejected']).optional().openapi({ description: '状态过滤，默认 pending' }),
      entityType:    z.string().optional(),
      reviewerId:    z.string().optional(),
      from:          z.string().optional().openapi({ description: 'ISO 日期，reviewedAt >=' }),
      to:            z.string().optional().openapi({ description: 'ISO 日期，reviewedAt <=' }),
      minConfidence: z.string().optional().openapi({ description: '最低置信度 0–1（包含）' }),
      maxConfidence: z.string().optional().openapi({ description: '最高置信度 0–1（包含）' }),
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
  const rawMin       = c.req.query('minConfidence')
  const rawMax       = c.req.query('maxConfidence')
  const minConf      = rawMin != null ? Number(rawMin) : undefined
  const maxConf      = rawMax != null ? Number(rawMax) : undefined
  const { page, pageSize, skip } = parsePagination(c.req.query())

  if (!VALID_STATUSES.has(statusParam))
    return c.json({ code: 400, message: `status 无效，可选值：${[...VALID_STATUSES].join(', ')}` }, 400)

  // 校验置信度：非数值（NaN）会被传进 Prisma 触发 500，须前置拦成 400（#143）
  for (const [name, v] of [['minConfidence', minConf], ['maxConfidence', maxConf]] as const) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1))
      return c.json({ code: 400, message: `${name} 必须为 0~1 的数值` }, 400)
  }
  if (minConf !== undefined && maxConf !== undefined && minConf > maxConf)
    return c.json({ code: 400, message: 'minConfidence 不能大于 maxConfidence' }, 400)

  const where: PrismaTypes.EntityTagWhereInput = {
    status: statusParam as TagStatus,
    tag: { deletedAt: null },
    ...(entityType ? { entityType }   : {}),
    ...(reviewerId ? { reviewerId }   : {}),
    ...(from || to ? { reviewedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    ...((minConf != null || maxConf != null) ? {
      confidence: {
        ...(minConf != null ? { gte: minConf } : {}),
        ...(maxConf != null ? { lte: maxConf } : {}),
      },
    } : {}),
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
    const { page, pageSize, skip: offset } = parsePagination(c.req.query())

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
  const { page, pageSize, skip } = parsePagination(c.req.query())
  const withTags = parseBool(c.req.query('withTags'))
  const where    = { entityType, ...(search ? { entityId: { contains: search } } : {}) }
  const total    = await prisma.registeredEntity.count({ where })

  if (withTags) {
    const rows = await prisma.registeredEntity.findMany({
      where,
      select: {
        entityType: true, entityId: true, registeredAt: true, metadata: true,
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
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,  // #142：回 name 供前端展示
      tags: r.entityTags.map(et => ({ id: et.tag.id, slug: et.tag.slug, name: et.tag.name, groupId: et.tag.groupId, group: et.tag.group, source: et.source, confidence: et.confidence, status: et.status as string, taggedAt: et.createdAt.toISOString() })),
    }))
    return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
  }

  const rows = await prisma.registeredEntity.findMany({ where, select: { entityType: true, entityId: true, registeredAt: true, metadata: true }, orderBy: { registeredAt: 'desc' }, skip, take: pageSize })
  const items = rows.map(r => ({ entityType: r.entityType, entityId: r.entityId, registeredAt: r.registeredAt.toISOString(), metadata: (r.metadata ?? null) as Record<string, unknown> | null }))
  return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
})

// ── POST /audit/undo ──────────────────────────────────────────────────────────
// 服务端撤销：根据 reviewIds 把 EntityTag.status 还原到审核前的 fromStatus。
// 仅在当前 status 仍等于 review.toStatus 时执行（防止覆盖后续操作）。
const undoAuditRoute = createRoute({
  method: 'post', path: '/audit/undo',
  tags: ['实体标签'],
  summary: '撤销审核操作（按 reviewId 回滚）',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            reviewIds: z.array(z.string().min(1)).min(1).max(100)
              .openapi({ description: '需要撤销的 EntityTagReview ID 列表（最多 100 条）' }),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: okData(z.object({ reverted: z.number(), skipped: z.number() })) } },
      description: '成功，返回实际回滚数量和因状态已变更而跳过的数量',
    },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
})

auditRouter.use('/audit/undo', requireRole('reviewer'))
auditRouter.openapi(undoAuditRoute, async (c) => {
  const { reviewIds } = c.req.valid('json')
  const reviewerId = getTokenId(c)

  const reviews = await prisma.entityTagReview.findMany({
    where: { id: { in: reviewIds } },
    select: { id: true, tagId: true, entityType: true, entityId: true, fromStatus: true, toStatus: true },
  })

  let reverted = 0
  let skipped  = 0

  await prisma.$transaction(async (tx) => {
    for (const review of reviews) {
      const current = await tx.entityTag.findUnique({
        where: { tagId_entityType_entityId: { tagId: review.tagId, entityType: review.entityType, entityId: review.entityId } },
        select: { status: true },
      })
      // Skip if EntityTag no longer exists or has been modified after this review
      if (!current || current.status !== review.toStatus) { skipped++; continue }

      await tx.entityTag.update({
        where: { tagId_entityType_entityId: { tagId: review.tagId, entityType: review.entityType, entityId: review.entityId } },
        data:  { status: review.fromStatus, reviewedAt: new Date(), reviewerId, reviewNote: '撤销', previousStatus: current.status },
      })

      // Gauge: toStatus was the "committed" state, fromStatus is what we're reverting to
      if (review.toStatus !== 'pending' && review.fromStatus === 'pending') incAuditGauge()
      else if (review.toStatus === 'pending' && review.fromStatus !== 'pending') decAuditGauge()

      // Record the undo as its own review entry
      await tx.entityTagReview.create({
        data: {
          tagId: review.tagId, entityType: review.entityType, entityId: review.entityId,
          reviewerId, fromStatus: review.toStatus, toStatus: review.fromStatus, note: '撤销', isRevert: true,
        },
      })

      reverted++
    }
  })

  return c.json({ code: 0, data: { reverted, skipped } }, 200)
})
