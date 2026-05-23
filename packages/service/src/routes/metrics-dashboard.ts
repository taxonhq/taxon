/**
 * Dashboard metrics 路由
 *
 * 提供大屏 dashboard 所需的聚合数据：
 *  - GET /metrics/trend?period=7d   每日新增标签/实体/审核 时间序列
 *  - GET /metrics/today              当日统计 + 同比（7 日均值对比）
 *  - GET /metrics/activity?limit=10  最近活动流（标签新增、审核操作）
 *
 * 注意：这些端点是聚合只读视图，无需鉴权区分（与 health 同级公开）。
 */

import { Hono } from 'hono'
import prisma from '../lib/db.js'

export const dashboardMetrics = new Hono()

// ── 工具：生成连续 N 天的日期序列（UTC 0 点）────────────────────
function dateRange(days: number): Date[] {
  const out: Date[] = []
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(d)
  }
  return out
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

// ── GET /metrics/trend?period=7d ─────────────────────────────────
// 返回最近 N 天每天的：新增标签、新增实体、审核完成数
dashboardMetrics.get('/trend', async (c) => {
  const period = c.req.query('period') ?? '7d'
  const days = period === '30d' ? 30 : period === '14d' ? 14 : 7
  const dates = dateRange(days)
  const since = dates[0]

  // Postgres date_trunc 按 UTC 日聚合
  const tagsBuckets = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
    FROM "EntityTag"
    WHERE "createdAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `
  const entitiesBuckets = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "registeredAt") AS day, COUNT(*)::bigint AS count
    FROM "RegisteredEntity"
    WHERE "registeredAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `
  const reviewsBuckets = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "reviewedAt") AS day, COUNT(*)::bigint AS count
    FROM "EntityTagReview"
    WHERE "reviewedAt" >= ${since}
    GROUP BY day
    ORDER BY day ASC
  `

  const toMap = (rows: { day: Date; count: bigint }[]) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(dayKey(r.day), Number(r.count))
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
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
  const weekAgo    = new Date(todayStart); weekAgo.setUTCDate(weekAgo.getUTCDate() - 7)

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
