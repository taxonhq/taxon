/**
 * 标签治理 API  (issue #35)
 *
 * GET /governance/tag-usage              — 使用度榜单
 * GET /governance/dead-tags             — 死标签清理建议
 * GET /governance/duplicate-suggestions — 重复标签检测
 */

import { Hono } from 'hono'
import { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'

export const governanceRouter = new Hono()

// 所有治理端点需要 reader 以上权限
governanceRouter.use('/*', requireRole('reader'))

// ── 工具 ─────────────────────────────────────────────────────────────────────

const PERIOD_DAYS = { '7d': 7, '14d': 14, '30d': 30, '90d': 90, '180d': 180, '1y': 365 } as const
type Period = keyof typeof PERIOD_DAYS

function cutoffDate(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

/** 简单 Levenshtein 距离 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length > b.length) [a, b] = [b, a]
  const prev = Array.from({ length: a.length + 1 }, (_, i) => i)
  const curr = new Array<number>(a.length + 1)
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost)
    }
    for (let i = 0; i <= a.length; i++) prev[i] = curr[i]
  }
  return prev[a.length]
}

/** 0-1 相似度（1 = 完全一致） */
function strSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

// ── GET /governance/tag-usage ─────────────────────────────────────────────────

type UsageRow = {
  tagId: string
  name: string
  slug: string
  groupId: string
  groupName: string
  groupSlug: string
  usageCount: bigint
  lastUsedAt: Date | null
}

governanceRouter.get('/tag-usage', async (c) => {
  const groupId = c.req.query('groupId') || undefined
  const periodKey = (c.req.query('period') ?? '30d') as Period
  const days      = PERIOD_DAYS[periodKey] ?? 30
  const order     = c.req.query('order') === 'asc' ? 'asc' : 'desc'
  const limit     = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200)
  const period    = periodKey in PERIOD_DAYS ? periodKey : undefined
  const cutoff    = period ? cutoffDate(days) : null

  const groupFilter  = groupId ? Prisma.sql`AND t."groupId" = ${groupId}`    : Prisma.empty
  const periodFilter = cutoff  ? Prisma.sql`AND et."createdAt" >= ${cutoff}` : Prisma.empty
  const orderDir     = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

  const rows = await prisma.$queryRaw<UsageRow[]>(Prisma.sql`
    SELECT
      t.id            AS "tagId",
      t.name,
      t.slug,
      t."groupId",
      tg.name         AS "groupName",
      tg.slug         AS "groupSlug",
      COUNT(et."tagId")::bigint  AS "usageCount",
      MAX(et."createdAt")        AS "lastUsedAt"
    FROM "Tag" t
    JOIN "TagGroup" tg ON tg.id = t."groupId"
    LEFT JOIN "EntityTag" et
      ON  et."tagId" = t.id
      AND et.status  = 'active'
      ${periodFilter}
    WHERE t."deletedAt"  IS NULL
      AND tg."deletedAt" IS NULL
      ${groupFilter}
    GROUP BY t.id, t.name, t.slug, t."groupId", tg.name, tg.slug
    ORDER BY "usageCount" ${orderDir}, t.name ASC
    LIMIT ${limit}
  `)

  return c.json({
    code: 0,
    data: {
      period: period ?? 'all',
      items: rows.map(r => ({
        tagId:      r.tagId,
        name:       r.name,
        slug:       r.slug,
        groupId:    r.groupId,
        groupName:  r.groupName,
        groupSlug:  r.groupSlug,
        usageCount: Number(r.usageCount),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      })),
    },
  })
})

// ── GET /governance/dead-tags ─────────────────────────────────────────────────

type DeadRow = {
  tagId: string
  name: string
  slug: string
  groupId: string
  groupName: string
  groupSlug: string
  depth: number
  activeCount: bigint
  lastUsedAt: Date | null
}

governanceRouter.get('/dead-tags', async (c) => {
  const groupId   = c.req.query('groupId') || undefined
  const periodKey = (c.req.query('period') ?? '90d') as Period
  const days      = PERIOD_DAYS[periodKey] ?? 90
  const limit     = Math.min(Math.max(Number(c.req.query('limit') ?? 100), 1), 500)
  const cutoff    = cutoffDate(days)

  const groupFilter = groupId ? Prisma.sql`AND t."groupId" = ${groupId}` : Prisma.empty

  const rows = await prisma.$queryRaw<DeadRow[]>(Prisma.sql`
    SELECT
      t.id            AS "tagId",
      t.name,
      t.slug,
      t."groupId",
      tg.name         AS "groupName",
      tg.slug         AS "groupSlug",
      t.depth,
      COUNT(et."tagId")::bigint AS "activeCount",
      MAX(et."createdAt")       AS "lastUsedAt"
    FROM "Tag" t
    JOIN "TagGroup" tg ON tg.id = t."groupId"
    LEFT JOIN "EntityTag" et
      ON  et."tagId" = t.id
      AND et.status  = 'active'
    WHERE t."deletedAt"  IS NULL
      AND tg."deletedAt" IS NULL
      ${groupFilter}
    GROUP BY t.id, t.name, t.slug, t."groupId", tg.name, tg.slug, t.depth
    HAVING MAX(et."createdAt") IS NULL
        OR MAX(et."createdAt") < ${cutoff}
    ORDER BY "activeCount" ASC, t.name ASC
    LIMIT ${limit}
  `)

  return c.json({
    code: 0,
    data: {
      period:  periodKey,
      cutoff:  cutoff.toISOString(),
      items: rows.map(r => ({
        tagId:       r.tagId,
        name:        r.name,
        slug:        r.slug,
        groupId:     r.groupId,
        groupName:   r.groupName,
        groupSlug:   r.groupSlug,
        depth:       r.depth,
        activeCount: Number(r.activeCount),
        lastUsedAt:  r.lastUsedAt?.toISOString() ?? null,
      })),
    },
  })
})

// ── GET /governance/duplicate-suggestions ────────────────────────────────────

interface DuplicatePair {
  sourceId:          string
  sourceName:        string
  sourceSlug:        string
  targetId:          string
  targetName:        string
  targetSlug:        string
  groupId:           string
  groupName:         string
  groupSlug:         string
  similarity:        number
  reason:            string
  sharedEntityCount: number
}

type TagRow = {
  id: string
  name: string
  slug: string
  groupId: string
  groupName: string
  groupSlug: string
  aliases: string[]
}

governanceRouter.get('/duplicate-suggestions', async (c) => {
  const groupId   = c.req.query('groupId') || undefined
  const threshold = Math.min(Math.max(Number(c.req.query('threshold') ?? 0.75), 0.5), 1)
  const limit     = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100)

  const groupFilter = groupId ? Prisma.sql`AND t."groupId" = ${groupId}` : Prisma.empty

  const tagRows = await prisma.$queryRaw<Array<{
    id: string; name: string; slug: string
    groupId: string; groupName: string; groupSlug: string
  }>>(Prisma.sql`
    SELECT
      t.id,
      t.name,
      t.slug,
      t."groupId",
      tg.name AS "groupName",
      tg.slug AS "groupSlug"
    FROM "Tag" t
    JOIN "TagGroup" tg ON tg.id = t."groupId"
    WHERE t."deletedAt" IS NULL AND tg."deletedAt" IS NULL
      ${groupFilter}
    ORDER BY t."groupId", t.name
  `)

  const aliasRows = await prisma.tagAlias.findMany({
    where: { tag: { deletedAt: null, ...(groupId ? { groupId } : {}) } },
    select: { tagId: true, alias: true },
  })
  const aliasMap = new Map<string, string[]>()
  for (const { tagId, alias } of aliasRows) {
    const list = aliasMap.get(tagId) ?? []
    list.push(alias.toLowerCase())
    aliasMap.set(tagId, list)
  }

  const tags: TagRow[] = tagRows.map(r => ({
    ...r,
    aliases: aliasMap.get(r.id) ?? [],
  }))

  // 按 groupId 分组后，组内 pairwise 检测（每组上限 500 防止 O(n²) 爆炸）
  const byGroup = new Map<string, TagRow[]>()
  for (const t of tags) {
    const list = byGroup.get(t.groupId) ?? []
    list.push(t)
    byGroup.set(t.groupId, list)
  }

  const pairs: DuplicatePair[] = []

  for (const groupTags of byGroup.values()) {
    const subset = groupTags.slice(0, 500)

    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const a = subset[i]
        const b = subset[j]
        const aN = a.name.toLowerCase()
        const bN = b.name.toLowerCase()

        let reason = ''
        let sim    = 0

        const nameSim = strSimilarity(aN, bN)
        const slugSim = strSimilarity(a.slug, b.slug)
        sim = Math.max(nameSim, slugSim)

        if (sim >= threshold) {
          reason = nameSim >= slugSim ? 'name_similarity' : 'slug_similarity'
        }

        // alias 覆盖检测
        if (!reason) {
          const bNamesSet = new Set([bN, b.slug, ...b.aliases])
          const aNamesSet = new Set([aN, a.slug, ...a.aliases])
          if (a.aliases.some(al => bNamesSet.has(al)) || b.aliases.some(al => aNamesSet.has(al))) {
            reason = 'alias_overlap'
            sim    = Math.max(sim, 0.9)
          }
        }

        if (!reason) continue

        pairs.push({
          sourceId:   a.id,
          sourceName: a.name,
          sourceSlug: a.slug,
          targetId:   b.id,
          targetName: b.name,
          targetSlug: b.slug,
          groupId:    a.groupId,
          groupName:  a.groupName,
          groupSlug:  a.groupSlug,
          similarity: Math.round(sim * 100) / 100,
          reason,
          sharedEntityCount: 0,
        })
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity)
  const topPairs = pairs.slice(0, limit)

  // 批量补充 sharedEntityCount
  for (const pair of topPairs) {
    const rows = await prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
      SELECT COUNT(DISTINCT et1."entityId")::bigint AS count
      FROM "EntityTag" et1
      JOIN "EntityTag" et2
        ON  et2."entityType" = et1."entityType"
        AND et2."entityId"   = et1."entityId"
        AND et2."tagId"      = ${pair.targetId}
      WHERE et1."tagId" = ${pair.sourceId}
        AND et1.status  = 'active'
        AND et2.status  = 'active'
    `)
    pair.sharedEntityCount = Number(rows[0]?.count ?? 0)
  }

  return c.json({ code: 0, data: { items: topPairs } })
})
