/**
 * Dashboard metrics 路由
 *
 * 提供大屏 dashboard 所需的聚合数据：
 *  - GET /metrics/trend?period=7d        每日新增标签/实体/审核 时间序列
 *  - GET /metrics/today                   当日统计 + 同比（7 日均值对比）
 *  - GET /metrics/activity?limit=10       最近活动流（标签新增、审核操作）
 *  - GET /metrics/reviewer-stats          当前审核员今日 / 区间工作量（需鉴权）
 *  - GET /metrics/leaderboard             团队审核榜单（需鉴权；普通 reviewer 仅见自己）
 *
 * 注意：trend / today / activity 是聚合只读视图，无需鉴权。
 *       reviewer-stats / leaderboard 需要 reviewer 级别 Token。
 */

import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import { bearerAuth, requireRole, getTokenId } from '../middleware/auth.js'
import type { ApiRole } from '../middleware/auth.js'
import { APP_TZ_OFFSET_MIN, localDayStartUTC, localDayKey } from '../lib/time.js'

type AuthVars = { Variables: { tokenRole: ApiRole; tokenName: string; tokenId: string } }

export const dashboardMetrics = new Hono<AuthVars>()

// ── 工具：生成连续 N 天的日期序列（按 APP_TZ_OFFSET_MIN 的本地 0 点，#148）──────
function dateRange(days: number): Date[] {
  const out: Date[] = []
  for (let i = days - 1; i >= 0; i--) out.push(localDayStartUTC(i))
  return out
}

const dayKey = localDayKey

// ── GET /metrics/trend?period=7d ─────────────────────────────────
// 返回最近 N 天每天的：新增标签、新增实体、审核完成数
dashboardMetrics.get('/trend', async (c) => {
  const period = c.req.query('period') ?? '7d'
  const days = period === '30d' ? 30 : period === '14d' ? 14 : 7
  const dates = dateRange(days)
  const since = dates[0]

  // 按本地时区（APP_TZ_OFFSET_MIN）日聚合：先把 timestamptz 转成 UTC 墙钟，
  // 再加偏移得到本地墙钟，to_char 取 YYYY-MM-DD（与 JS 端 dayKey 口径一致，#148）。
  const off = APP_TZ_OFFSET_MIN
  const tagsBuckets = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') + make_interval(mins => ${off}::int), 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
    FROM "EntityTag"
    WHERE "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `
  const entitiesBuckets = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(("registeredAt" AT TIME ZONE 'UTC') + make_interval(mins => ${off}::int), 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
    FROM "RegisteredEntity"
    WHERE "registeredAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `
  const reviewsBuckets = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(("reviewedAt" AT TIME ZONE 'UTC') + make_interval(mins => ${off}::int), 'YYYY-MM-DD') AS day, COUNT(*)::bigint AS count
    FROM "EntityTagReview"
    WHERE "reviewedAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `

  const toMap = (rows: { day: string; count: bigint }[]) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.day, Number(r.count))
    return m
  }
  const tagsMap     = toMap(tagsBuckets)
  const entitiesMap = toMap(entitiesBuckets)
  const reviewsMap  = toMap(reviewsBuckets)

  const series = dates.map(d => {
    const k = dayKey(d)
    return {
      date:     k,
      tags:     tagsMap.get(k)     ?? 0,
      entities: entitiesMap.get(k) ?? 0,
      reviews:  reviewsMap.get(k)  ?? 0,
    }
  })

  return c.json({ code: 0, data: { period, series } })
})

// ── GET /metrics/today ───────────────────────────────────────────
// 当日新增 vs 前 7 日均值的同比变化
dashboardMetrics.get('/today', async (c) => {
  // 按 APP_TZ_OFFSET_MIN 的本地日界（#148）
  const todayStart = localDayStartUTC(0)
  const weekAgo    = localDayStartUTC(7)

  const [tagsToday, tagsWeek, entitiesToday, entitiesWeek, auditsToday, auditsWeek] = await Promise.all([
    prisma.entityTag.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.entityTag.count({ where: { createdAt: { gte: weekAgo, lt: todayStart } } }),
    prisma.registeredEntity.count({ where: { registeredAt: { gte: todayStart } } }),
    prisma.registeredEntity.count({ where: { registeredAt: { gte: weekAgo, lt: todayStart } } }),
    prisma.entityTagReview.count({ where: { reviewedAt: { gte: todayStart } } }),
    prisma.entityTagReview.count({ where: { reviewedAt: { gte: weekAgo, lt: todayStart } } }),
  ])

  // 同比：今日值 vs 过去 7 天日均
  const compare = (today: number, week: number) => {
    const avg = week / 7
    if (avg === 0) return today > 0 ? 100 : 0
    return Math.round(((today - avg) / avg) * 100)
  }

  return c.json({
    code: 0,
    data: {
      tags:     { today: tagsToday,     comparePct: compare(tagsToday,     tagsWeek)     },
      entities: { today: entitiesToday, comparePct: compare(entitiesToday, entitiesWeek) },
      audits:   { today: auditsToday,   comparePct: compare(auditsToday,   auditsWeek)   },
    },
  })
})

// ── GET /metrics/activity?limit=10 ───────────────────────────────
// 最近的标签新增 + 审核事件，按时间倒序合并
dashboardMetrics.get('/activity', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 50)

  const [tags, reviews] = await Promise.all([
    prisma.entityTag.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { tag: { select: { name: true, group: { select: { name: true } } } } },
    }),
    prisma.entityTagReview.findMany({
      orderBy: { reviewedAt: 'desc' },
      take: limit,
      include: { entityTag: { include: { tag: { select: { name: true } } } } },
    }),
  ])

  const events = [
    ...tags.map(t => ({
      kind:       'tag-added' as const,
      time:       t.createdAt.toISOString(),
      source:     t.source,
      entityType: t.entityType,
      entityId:   t.entityId,
      tagName:    t.tag.name,
      groupName:  t.tag.group.name,
    })),
    ...reviews.map(r => ({
      kind:       'review' as const,
      time:       r.reviewedAt.toISOString(),
      fromStatus: r.fromStatus,
      toStatus:   r.toStatus,
      entityType: r.entityType,
      entityId:   r.entityId,
      tagName:    r.entityTag.tag.name,
    })),
  ]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, limit)

  return c.json({ code: 0, data: events })
})

// ── GET /metrics/reviewer-stats ──────────────────────────────────
// 返回当前（或指定）审核员在给定时间范围内的工作量统计。
// 普通 reviewer 只能查自己；admin 可传 reviewerId 查任意人。
dashboardMetrics.use('/reviewer-stats', bearerAuth, requireRole('reviewer'))
dashboardMetrics.get('/reviewer-stats', async (c) => {
  const role      = c.get('tokenRole') as ApiRole
  const currentId = getTokenId(c)

  // 权限隔离：非 admin 忽略传入的 reviewerId，只返回自己的数据
  const reqId     = c.req.query('reviewerId')
  const reviewerId = role === 'admin' && reqId ? reqId : (currentId ?? undefined)

  const fromRaw = c.req.query('from')
  const toRaw   = c.req.query('to')
  const from    = fromRaw ? new Date(fromRaw) : undefined
  const to      = toRaw   ? new Date(toRaw)   : undefined

  const base = {
    ...(reviewerId ? { reviewerId } : {}),
    ...(from || to ? { reviewedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  }

  const [approved, rejected, reverted] = await Promise.all([
    prisma.entityTagReview.count({ where: { ...base, fromStatus: 'pending', toStatus: 'active'   } }),
    prisma.entityTagReview.count({ where: { ...base, fromStatus: 'pending', toStatus: 'rejected' } }),
    prisma.entityTagReview.count({ where: { ...base, isRevert: true } }),
  ])

  const totalReviews = approved + rejected
  const approveRate  = totalReviews > 0 ? Math.round(approved / totalReviews * 100) / 100 : null

  return c.json({
    code: 0,
    data: { reviewerId: reviewerId ?? null, totalReviews, approved, rejected, reverted, approveRate },
  })
})

// ── GET /metrics/leaderboard ─────────────────────────────────────
// 团队审核榜单（按 approved+rejected 总数降序）。
// 普通 reviewer 只能看到自己的一行；admin 可看全部榜单。
dashboardMetrics.use('/leaderboard', bearerAuth, requireRole('reviewer'))
dashboardMetrics.get('/leaderboard', async (c) => {
  const role      = c.get('tokenRole') as ApiRole
  const currentId = getTokenId(c)

  const period = c.req.query('period') ?? '7d'
  const limit  = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 10)))

  const since  = period === '30d' ? new Date(Date.now() - 30 * 86_400_000) :
                 period === 'all'  ? null :
                 new Date(Date.now() - 7 * 86_400_000)

  type Row = { reviewerId: string | null; approved: bigint; rejected: bigint }
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT
      "reviewerId",
      COUNT(*) FILTER (WHERE "fromStatus" = 'pending' AND "toStatus" = 'active')   AS approved,
      COUNT(*) FILTER (WHERE "fromStatus" = 'pending' AND "toStatus" = 'rejected')  AS rejected
    FROM "EntityTagReview"
    WHERE "fromStatus" = 'pending'
    ${since       ? Prisma.sql`AND "reviewedAt" >= ${since}`       : Prisma.empty}
    ${role !== 'admin' ? Prisma.sql`AND "reviewerId" = ${currentId}` : Prisma.empty}
    GROUP BY "reviewerId"
    ORDER BY (
      COUNT(*) FILTER (WHERE "fromStatus" = 'pending' AND "toStatus" = 'active') +
      COUNT(*) FILTER (WHERE "fromStatus" = 'pending' AND "toStatus" = 'rejected')
    ) DESC
    LIMIT ${limit}
  `)

  // Resolve reviewer names from ApiToken
  const reviewerIds = rows.map(r => r.reviewerId).filter((id): id is string => id != null)
  const tokenMap    = new Map<string, string>()
  if (reviewerIds.length > 0) {
    const tokens = await prisma.apiToken.findMany({
      where:  { id: { in: reviewerIds } },
      select: { id: true, name: true },
    })
    tokens.forEach(t => tokenMap.set(t.id, t.name))
  }

  const items = rows.map(r => {
    const approved = Number(r.approved)
    const rejected = Number(r.rejected)
    const total    = approved + rejected
    return {
      reviewerId:    r.reviewerId ?? null,
      name:          r.reviewerId ? (tokenMap.get(r.reviewerId) ?? r.reviewerId) : '匿名',
      total,
      approved,
      rejected,
      approveRate:   total > 0 ? Math.round(approved / total * 100) / 100 : null,
      isCurrentUser: r.reviewerId === currentId,
    }
  })

  return c.json({ code: 0, data: { period, items } })
})
