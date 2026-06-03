/**
 * 只读查询路由
 *   GET /resolve
 *   GET /
 *   GET /:tagId
 *   GET /:tagId/descendants
 *   GET /:tagId/ancestors
 */
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../../lib/router.js'
import prisma from '../../lib/db.js'
import { parsePagination } from '../../lib/pagination.js'
import { TagSchema, ApiError, okData, Paginated, PaginationQuery } from '../../lib/schemas.js'

export const tagsQuery = createRouter()

const TagIdParam = z.object({ tagId: z.string().min(1).openapi({ description: '标签 ID' }) })

// ── GET /resolve ──────────────────────────────────────────────────────────────
const resolveTagRoute = createRoute({
  method: 'get', path: '/resolve',
  tags: ['标签'],
  summary: '按 name/slug/alias 解析标签',
  request: {
    query: z.object({
      q:       z.string().min(1).openapi({ description: '查询词（name、slug 或 alias）' }),
      groupId: z.string().optional().openapi({ description: '限定分组范围' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.object({ tag: TagSchema, matchedBy: z.enum(['name', 'slug', 'alias']) })) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '未找到' },
  },
})

tagsQuery.openapi(resolveTagRoute, async (c) => {
  const { q, groupId } = c.req.valid('query')
  const groupFilter = groupId ? { groupId } : {}

  const byName = await prisma.tag.findFirst({ where: { name: q, deletedAt: null, ...groupFilter }, include: { group: { select: { id: true, slug: true, name: true } } } })
  if (byName) return c.json({ code: 0, data: { tag: byName, matchedBy: 'name' as const } }, 200)

  const bySlug = await prisma.tag.findFirst({ where: { slug: q, deletedAt: null, ...groupFilter }, include: { group: { select: { id: true, slug: true, name: true } } } })
  if (bySlug) return c.json({ code: 0, data: { tag: bySlug, matchedBy: 'slug' as const } }, 200)

  const byAlias = await prisma.tagAlias.findFirst({
    where: { alias: q, tag: { deletedAt: null, ...groupFilter } },
    include: { tag: { include: { group: { select: { id: true, slug: true, name: true } } } } },
  })
  if (byAlias) return c.json({ code: 0, data: { tag: byAlias.tag, matchedBy: 'alias' as const } }, 200)

  return c.json({ code: 404, message: '未找到匹配的标签' }, 404)
})

// ── GET / ─────────────────────────────────────────────────────────────────────
const listTagsRoute = createRoute({
  method: 'get', path: '/',
  tags: ['标签'],
  summary: '列出标签（支持按分组、名称过滤、分页）',
  request: {
    query: PaginationQuery.extend({
      groupId:  z.string().optional(),
      parentId: z.string().optional().openapi({ description: "'null' 表示只返回根节点" }),
      q:        z.string().optional().openapi({ description: '按名称模糊搜索' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(Paginated(TagSchema)) } }, description: '成功' },
  },
})

tagsQuery.openapi(listTagsRoute, async (c) => {
  const { page, pageSize, skip, take } = parsePagination(c.req.query())
  const groupId  = c.req.query('groupId')
  const parentId = c.req.query('parentId')
  const q        = c.req.query('q')

  const where = {
    deletedAt: null,
    ...(groupId ? { groupId } : {}),
    ...(parentId === 'null' ? { parentId: null } : parentId ? { parentId } : {}),
    ...(q ? { name: { contains: q } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      include: {
        group:    { select: { id: true, slug: true, name: true } },
        _count:   { select: { entityTags: { where: { status: 'active' } } } },
        children: { where: { deletedAt: null }, select: { id: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
      skip, take,
    }),
    prisma.tag.count({ where }),
  ])
  return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
})

// ── GET /:tagId ───────────────────────────────────────────────────────────────
const getTagRoute = createRoute({
  method: 'get', path: '/{tagId}',
  tags: ['标签'],
  summary: '获取单个标签详情',
  request: { params: TagIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagsQuery.openapi(getTagRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    include: {
      group:    true,
      parent:   { select: { id: true, slug: true, name: true } },
      children: { where: { deletedAt: null }, select: { id: true, slug: true, name: true, depth: true } },
      aliases:  { orderBy: { createdAt: 'asc' } },
      _count:   { select: { entityTags: { where: { status: 'active' } } } },
    },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
  return c.json({ code: 0, data: tag }, 200)
})

// ── GET /:tagId/descendants ───────────────────────────────────────────────────
const getDescendantsRoute = createRoute({
  method: 'get', path: '/{tagId}/descendants',
  tags: ['标签'],
  summary: '获取所有子孙标签',
  request: { params: TagIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.object({ items: z.array(TagSchema), total: z.number().int() })) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagsQuery.openapi(getDescendantsRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const tag = await prisma.tag.findUnique({ where: { id: tagId, deletedAt: null }, select: { path: true } })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  const items = await prisma.tag.findMany({
    where: { path: { startsWith: tag.path }, id: { not: tagId }, deletedAt: null },
    include: { _count: { select: { entityTags: { where: { status: 'active' } } } } },
    orderBy: { path: 'asc' },
  })
  return c.json({ code: 0, data: { items, total: items.length } }, 200)
})

// ── GET /:tagId/ancestors ─────────────────────────────────────────────────────
const getAncestorsRoute = createRoute({
  method: 'get', path: '/{tagId}/ancestors',
  tags: ['标签'],
  summary: '获取祖先链（从根到父，不含自身）',
  request: { params: TagIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), depth: z.number().int() }))) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagsQuery.openapi(getAncestorsRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const tag = await prisma.tag.findUnique({ where: { id: tagId, deletedAt: null }, select: { parentId: true } })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  const ancestors: { id: string; slug: string; name: string; depth: number }[] = []
  let currentParentId = tag.parentId
  while (currentParentId) {
    const parent = await prisma.tag.findUnique({ where: { id: currentParentId }, select: { id: true, slug: true, name: true, depth: true, parentId: true } })
    if (!parent) break
    ancestors.unshift(parent)
    currentParentId = parent.parentId
  }
  return c.json({ code: 0, data: ancestors }, 200)
})
