/**
 * 实体关系图谱（#100）—— 二部图（实体 + 标签），边即 EntityTag(status=active)。
 *
 *   GET /entity-graph/focus?entityType=X        — 推荐起始焦点（该类型最热标签）+ 其邻居
 *   GET /entity-graph/neighbors?node=<id>&limit  — 展开某节点的邻居（懒加载，永不全量）
 *
 * 节点 id 约定：
 *   - 标签节点：`tag:<tagId>`
 *   - 实体节点：`entity:<entityType>:<entityId>`（entityId 可含冒号，取首个冒号分隔）
 *
 * 核心原则：永不全量渲染。任意调用只返回一个节点的直接邻居（受 limit 兜底）。
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import { ApiError, okData } from '../lib/schemas.js'

export const entityGraphRouter = new OpenAPIHono()

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

// ── 响应 schema ───────────────────────────────────────────────────────────────
const GraphNode = z.object({
  id:    z.string().openapi({ example: 'tag:clxxx' }),
  kind:  z.enum(['entity', 'tag']),
  label: z.string(),
  // tag 节点
  groupId:     z.string().optional(),
  groupSlug:   z.string().optional(),
  entityCount: z.number().int().optional(),
  // entity 节点
  entityType: z.string().optional(),
  entityId:   z.string().optional(),
  tagCount:   z.number().int().optional(),
}).openapi('GraphNode')

const GraphLink = z.object({
  source: z.string(),
  target: z.string(),
}).openapi('GraphLink')

const GraphData = z.object({
  focus:     z.string().nullable().openapi({ description: '焦点节点 id（neighbors 即被展开的节点）' }),
  nodes:     z.array(GraphNode),
  links:     z.array(GraphLink),
  truncated: z.boolean().openapi({ description: '邻居数超过 limit 被截断' }),
}).openapi('GraphData')

// ── 工具 ──────────────────────────────────────────────────────────────────────
type Parsed =
  | { kind: 'tag'; tagId: string }
  | { kind: 'entity'; entityType: string; entityId: string }

function parseNode(node: string): Parsed | null {
  if (node.startsWith('tag:')) {
    const tagId = node.slice(4)
    return tagId ? { kind: 'tag', tagId } : null
  }
  if (node.startsWith('entity:')) {
    const rest = node.slice(7)
    const i = rest.indexOf(':')
    if (i <= 0 || i === rest.length - 1) return null
    return { kind: 'entity', entityType: rest.slice(0, i), entityId: rest.slice(i + 1) }
  }
  return null
}

const tagNodeId = (tagId: string) => `tag:${tagId}`
const entityNodeId = (t: string, id: string) => `entity:${t}:${id}`

function clampLimit(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : DEFAULT_LIMIT
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

type TagRow = { tagId: string; label: string; groupId: string; groupSlug: string; entityCount: number }
type EntityRow = { entityType: string; entityId: string; label: string; tagCount: number }

/** 展开一个标签节点 → 挂该标签的实体（active）。返回标签自身节点 + 实体邻居 + 边。 */
async function expandTag(tagId: string, limit: number) {
  const [tagInfo] = await prisma.$queryRaw<TagRow[]>`
    SELECT t.id AS "tagId", t.name AS label, t."groupId" AS "groupId", g.slug AS "groupSlug",
           (SELECT COUNT(*)::int FROM "EntityTag" e2 WHERE e2."tagId" = t.id AND e2.status = 'active') AS "entityCount"
    FROM "Tag" t JOIN "TagGroup" g ON g.id = t."groupId"
    WHERE t.id = ${tagId} AND t."deletedAt" IS NULL`
  if (!tagInfo) return null

  const rows = await prisma.$queryRaw<EntityRow[]>`
    SELECT et."entityType" AS "entityType", et."entityId" AS "entityId",
           COALESCE(re.metadata->>'name', et."entityId") AS label,
           (SELECT COUNT(*)::int FROM "EntityTag" e2
             WHERE e2."entityType" = et."entityType" AND e2."entityId" = et."entityId" AND e2.status = 'active') AS "tagCount"
    FROM "EntityTag" et
    JOIN "RegisteredEntity" re ON re."entityType" = et."entityType" AND re."entityId" = et."entityId"
    WHERE et."tagId" = ${tagId} AND et.status = 'active'
    ORDER BY "tagCount" DESC
    LIMIT ${limit + 1}`

  const truncated = rows.length > limit
  const entities = rows.slice(0, limit)
  const focusId = tagNodeId(tagId)

  const nodes = [
    { id: focusId, kind: 'tag' as const, label: tagInfo.label, groupId: tagInfo.groupId, groupSlug: tagInfo.groupSlug, entityCount: tagInfo.entityCount },
    ...entities.map(e => ({ id: entityNodeId(e.entityType, e.entityId), kind: 'entity' as const, label: e.label, entityType: e.entityType, entityId: e.entityId, tagCount: e.tagCount })),
  ]
  const links = entities.map(e => ({ source: focusId, target: entityNodeId(e.entityType, e.entityId) }))
  return { focus: focusId, nodes, links, truncated }
}

/** 展开一个实体节点 → 其标签（active）。返回实体自身节点 + 标签邻居 + 边。 */
async function expandEntity(entityType: string, entityId: string, limit: number) {
  const [entInfo] = await prisma.$queryRaw<{ label: string; tagCount: number }[]>`
    SELECT COALESCE(re.metadata->>'name', ${entityId}) AS label,
           (SELECT COUNT(*)::int FROM "EntityTag" e2
             WHERE e2."entityType" = ${entityType} AND e2."entityId" = ${entityId} AND e2.status = 'active') AS "tagCount"
    FROM "RegisteredEntity" re
    WHERE re."entityType" = ${entityType} AND re."entityId" = ${entityId}`
  if (!entInfo) return null

  const rows = await prisma.$queryRaw<TagRow[]>`
    SELECT t.id AS "tagId", t.name AS label, t."groupId" AS "groupId", g.slug AS "groupSlug",
           (SELECT COUNT(*)::int FROM "EntityTag" e2 WHERE e2."tagId" = t.id AND e2.status = 'active') AS "entityCount"
    FROM "EntityTag" et
    JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
    JOIN "TagGroup" g ON g.id = t."groupId"
    WHERE et."entityType" = ${entityType} AND et."entityId" = ${entityId} AND et.status = 'active'
    ORDER BY "entityCount" DESC
    LIMIT ${limit + 1}`

  const truncated = rows.length > limit
  const tags = rows.slice(0, limit)
  const focusId = entityNodeId(entityType, entityId)

  const nodes = [
    { id: focusId, kind: 'entity' as const, label: entInfo.label, entityType, entityId, tagCount: entInfo.tagCount },
    ...tags.map(t => ({ id: tagNodeId(t.tagId), kind: 'tag' as const, label: t.label, groupId: t.groupId, groupSlug: t.groupSlug, entityCount: t.entityCount })),
  ]
  const links = tags.map(t => ({ source: focusId, target: tagNodeId(t.tagId) }))
  return { focus: focusId, nodes, links, truncated }
}

// ── GET /focus ────────────────────────────────────────────────────────────────
const focusRoute = createRoute({
  method: 'get', path: '/focus',
  tags: ['实体图谱'],
  summary: '推荐起始焦点（某 entityType 下最热标签）+ 其邻居',
  security: [{ BearerAuth: [] }],
  request: { query: z.object({ entityType: z.string().min(1).openapi({ example: 'dish' }), limit: z.string().optional() }) },
  responses: {
    200: { content: { 'application/json': { schema: okData(GraphData) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '该类型下无标签数据' },
    500: { content: { 'application/json': { schema: ApiError } }, description: '服务器错误' },
  },
})
entityGraphRouter.use('/focus', requireRole('reader'))
entityGraphRouter.openapi(focusRoute, async (c) => {
  const { entityType, limit } = c.req.valid('query')
  const lim = clampLimit(limit)
  try {
    const [hot] = await prisma.$queryRaw<{ tagId: string }[]>`
      SELECT et."tagId" AS "tagId"
      FROM "EntityTag" et
      JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
      WHERE et."entityType" = ${entityType} AND et.status = 'active'
      GROUP BY et."tagId"
      ORDER BY COUNT(*) DESC
      LIMIT 1`
    if (!hot) return c.json({ code: 404, message: `「${entityType}」下暂无标签关系数据` }, 404)
    const sub = await expandTag(hot.tagId, lim)
    if (!sub) return c.json({ code: 404, message: `「${entityType}」下暂无标签关系数据` }, 404)
    return c.json({ code: 0, data: sub }, 200)
  } catch (e) {
    logger.error({ err: e, entityType }, 'entity-graph focus error')
    return c.json({ code: 500, message: '图谱焦点查询失败' }, 500)
  }
})

// ── GET /neighbors ────────────────────────────────────────────────────────────
const neighborsRoute = createRoute({
  method: 'get', path: '/neighbors',
  tags: ['实体图谱'],
  summary: '展开某节点的直接邻居（懒加载，永不全量）',
  description: '`node` 为 `tag:<tagId>` 或 `entity:<entityType>:<entityId>`。返回该节点 + 其 active 邻居（受 limit 兜底，超出标 truncated）。',
  security: [{ BearerAuth: [] }],
  request: { query: z.object({ node: z.string().min(1).openapi({ example: 'tag:clxxx' }), limit: z.string().optional() }) },
  responses: {
    200: { content: { 'application/json': { schema: okData(GraphData) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: 'node 格式非法' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '节点不存在' },
    500: { content: { 'application/json': { schema: ApiError } }, description: '服务器错误' },
  },
})
entityGraphRouter.use('/neighbors', requireRole('reader'))
entityGraphRouter.openapi(neighborsRoute, async (c) => {
  const { node, limit } = c.req.valid('query')
  const lim = clampLimit(limit)
  const parsed = parseNode(node)
  if (!parsed) return c.json({ code: 400, message: 'node 格式非法，应为 tag:<id> 或 entity:<type>:<id>' }, 400)
  try {
    const sub = parsed.kind === 'tag'
      ? await expandTag(parsed.tagId, lim)
      : await expandEntity(parsed.entityType, parsed.entityId, lim)
    if (!sub) return c.json({ code: 404, message: '节点不存在' }, 404)
    return c.json({ code: 0, data: sub }, 200)
  } catch (e) {
    logger.error({ err: e, node }, 'entity-graph neighbors error')
    return c.json({ code: 500, message: '邻居查询失败' }, 500)
  }
})

// ── GET /aggregate ────────────────────────────────────────────────────────────

const AGG_MAX_NODES = 200
const AGG_MAX_EDGES = 1000

type AggNodeRow = { tagId: string; label: string; groupId: string; groupSlug: string; entityCount: number }
type AggEdgeRow = { src: string; tgt: string; weight: number }

const AggNode = z.object({
  id:          z.string().openapi({ example: 'tag:clxxx' }),
  label:       z.string(),
  groupId:     z.string(),
  groupSlug:   z.string(),
  entityCount: z.number().int(),
}).openapi('AggNode')

const AggLink = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number().int().openapi({ description: '共享实体数（共现强度）' }),
}).openapi('AggLink')

const AggregateData = z.object({
  nodes: z.array(AggNode),
  links: z.array(AggLink),
}).openapi('AggregateData')

const aggregateRoute = createRoute({
  method: 'get', path: '/aggregate',
  tags: ['实体图谱'],
  summary: '标签星系聚合视图 — 节点 = 标签，边 = 共现强度',
  description: '把大量实体塌缩为标签维度：节点为标签，边粗细代表共享实体数。适合海量实体时快速理解标签宇宙的宏观结构。',
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      entityType:      z.string().min(1).openapi({ example: 'dish' }),
      minCooccurrence: z.string().optional().openapi({ description: '最小共现实体数，默认 2', example: '2' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(AggregateData) } }, description: '成功' },
    500: { content: { 'application/json': { schema: ApiError } }, description: '服务器错误' },
  },
})

entityGraphRouter.use('/aggregate', requireRole('reader'))
entityGraphRouter.openapi(aggregateRoute, async (c) => {
  const { entityType, minCooccurrence } = c.req.valid('query')
  const minCooc = Math.max(1, parseInt(minCooccurrence ?? '2', 10) || 2)

  try {
    const nodeRows = await prisma.$queryRaw<AggNodeRow[]>`
      SELECT t.id AS "tagId", t.name AS label, t."groupId", g.slug AS "groupSlug",
             COUNT(DISTINCT et."entityId")::int AS "entityCount"
      FROM "EntityTag" et
      JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
      JOIN "TagGroup" g ON g.id = t."groupId"
      WHERE et."entityType" = ${entityType} AND et.status = 'active'
      GROUP BY t.id, t.name, t."groupId", g.slug
      ORDER BY "entityCount" DESC
      LIMIT ${AGG_MAX_NODES}`

    if (nodeRows.length === 0) return c.json({ code: 0, data: { nodes: [], links: [] } }, 200)

    const tagIds = nodeRows.map(n => n.tagId)
    const edgeRows = await prisma.$queryRaw<AggEdgeRow[]>`
      SELECT et1."tagId" AS src, et2."tagId" AS tgt,
             COUNT(DISTINCT et1."entityId")::int AS weight
      FROM "EntityTag" et1
      JOIN "EntityTag" et2
        ON et2."entityType" = et1."entityType"
        AND et2."entityId" = et1."entityId"
        AND et2."tagId" > et1."tagId"
      WHERE et1."entityType" = ${entityType}
        AND et1.status = 'active'
        AND et2.status = 'active'
        AND et1."tagId" = ANY(${tagIds})
        AND et2."tagId" = ANY(${tagIds})
      GROUP BY et1."tagId", et2."tagId"
      HAVING COUNT(DISTINCT et1."entityId") >= ${minCooc}
      ORDER BY weight DESC
      LIMIT ${AGG_MAX_EDGES}`

    const nodes = nodeRows.map(n => ({
      id: tagNodeId(n.tagId), label: n.label, groupId: n.groupId, groupSlug: n.groupSlug, entityCount: n.entityCount,
    }))
    const links = edgeRows.map(e => ({
      source: tagNodeId(e.src), target: tagNodeId(e.tgt), weight: Number(e.weight),
    }))

    return c.json({ code: 0, data: { nodes, links } }, 200)
  } catch (e) {
    logger.error({ err: e, entityType }, 'entity-graph aggregate error')
    return c.json({ code: 500, message: '标签星系聚合查询失败' }, 500)
  }
})
