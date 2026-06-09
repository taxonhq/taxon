import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/router.js'
import prisma from '../lib/db.js'
import { parsePagination } from '../lib/pagination.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import { emitEvent } from '../lib/events.js'
import {
  TagGroupSchema, TagSchema, EntityRuleSchema,
  CreateTagGroupBody, UpdateTagGroupBody, EntityRulesBody,
  ApiError, OkMessage, okData, Paginated, PaginationQuery,
} from '../lib/schemas.js'

export const tagGroups = createRouter()

// ── Common params ─────────────────────────────────────────────────────────────
const GroupIdParam = z.object({ groupId: z.string().min(1).openapi({ description: '标签分组 ID' }) })

// ── GET / ─────────────────────────────────────────────────────────────────────
const listGroupsRoute = createRoute({
  method: 'get', path: '/',
  tags: ['标签分组'],
  summary: '列出分组',
  request: {
    query: PaginationQuery.extend({
      scope:            z.string().optional().openapi({ description: '按实体类型过滤' }),
      withPreviewTags:  z.enum(['true', 'false']).optional(),
      previewSize:      z.coerce.number().int().min(1).max(20).optional(),
      onlyDeleted:      z.enum(['true', 'false']).optional().openapi({ description: '仅返回软删除分组（回收站）' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(Paginated(TagGroupSchema)) } }, description: '成功' },
  },
})

tagGroups.openapi(listGroupsRoute, async (c) => {
  const { page, pageSize, skip, take } = parsePagination(c.req.query())
  const scopes = c.req.queries('scope') ?? []
  const withPreviewTags = c.req.query('withPreviewTags') === 'true'
  const previewSize = Math.min(20, Math.max(1, parseInt(c.req.query('previewSize') || '20')))
  const onlyDeleted = c.req.query('onlyDeleted') === 'true'

  const where = {
    ...(onlyDeleted ? { deletedAt: { not: null } } : { deletedAt: null }),
    ...(scopes.length > 0
      ? { OR: [
          { entityScopes: scopes.length === 1 ? { has: scopes[0] } : { hasSome: scopes } },
          { entityScopes: { isEmpty: true } },
        ] }
      : {}),
  }

  const [items, total] = await Promise.all([
    prisma.tagGroup.findMany({
      where,
      include: {
        _count: { select: { tags: { where: { deletedAt: null } } } },
        entityRules: true,
        ...(withPreviewTags ? {
          tags: {
            where:   { deletedAt: null },
            take:    previewSize,
            select:  { id: true, groupId: true, slug: true, name: true, description: true,
                       parentId: true, path: true, depth: true, sortOrder: true,
                       createdAt: true, updatedAt: true, deletedAt: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      skip, take,
    }),
    prisma.tagGroup.count({ where }),
  ])
  return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
})

// ── GET /:groupId ─────────────────────────────────────────────────────────────
const getGroupRoute = createRoute({
  method: 'get', path: '/{groupId}',
  tags: ['标签分组'],
  summary: '获取分组详情',
  request: { params: GroupIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagGroupSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagGroups.openapi(getGroupRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const group = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    include: { entityRules: true },
  })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)
  return c.json({ code: 0, data: group }, 200)
})

// ── GET /:groupId/tree ────────────────────────────────────────────────────────
const getGroupTreeRoute = createRoute({
  method: 'get', path: '/{groupId}/tree',
  tags: ['标签分组'],
  summary: '获取分组完整标签树',
  request: { params: GroupIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(z.any())) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagGroups.openapi(getGroupTreeRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const group = await prisma.tagGroup.findUnique({ where: { id: groupId, deletedAt: null }, select: { id: true } })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  const allTags = await prisma.tag.findMany({
    where: { groupId, deletedAt: null },
    select: {
      id: true, slug: true, name: true, description: true,
      parentId: true, path: true, depth: true, sortOrder: true,
      _count:   { select: { entityTags: { where: { status: 'active' } } } },
      aliases:  { select: { id: true, alias: true, source: true, createdAt: true, tagId: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ sortOrder: 'asc' }, { path: 'asc' }],
  })

  type TagNode = (typeof allTags)[number] & { children: TagNode[] }
  const map = new Map<string, TagNode>(allTags.map(t => [t.id, { ...t, children: [] }]))
  const roots: TagNode[] = []
  for (const tag of allTags) {
    const node = map.get(tag.id)!
    if (tag.parentId && map.has(tag.parentId)) map.get(tag.parentId)!.children.push(node)
    else roots.push(node)
  }
  return c.json({ code: 0, data: roots }, 200)
})

// ── POST / ────────────────────────────────────────────────────────────────────
const createGroupRoute = createRoute({
  method: 'post', path: '/',
  tags: ['标签分组'],
  summary: '创建分组',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: { body: { content: { 'application/json': { schema: CreateTagGroupBody } }, required: true } },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagGroupSchema) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '冲突' },
  },
})

tagGroups.openapi(createGroupRoute, async (c) => {
  const { slug, name, description, entityScopes, allowMultiple, sortOrder } = c.req.valid('json')

  const [conflictSlug, conflictName] = await Promise.all([
    prisma.tagGroup.findFirst({ where: { slug, deletedAt: null }, select: { id: true } }),
    prisma.tagGroup.findFirst({ where: { name, deletedAt: null }, select: { id: true } }),
  ])
  if (conflictSlug) return c.json({ code: 409, message: 'slug 已存在' }, 409)
  if (conflictName) return c.json({ code: 409, message: 'name 已存在' }, 409)

  try {
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.tagGroup.create({
        data: { slug, name, description, entityScopes, allowMultiple, sortOrder },
      })
      await emitEvent(tx, 'tag_group.created', { groupId: created.id, slug: created.slug, name: created.name })
      return created
    })
    return c.json({ code: 0, data: { ...group, createdAt: group.createdAt.toISOString(), updatedAt: group.updatedAt.toISOString(), deletedAt: group.deletedAt?.toISOString() ?? null } }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002')) return c.json({ code: 409, message: 'slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Create tag group error')
    throw error
  }
})

// ── PATCH /:groupId ───────────────────────────────────────────────────────────
const updateGroupRoute = createRoute({
  method: 'patch', path: '/{groupId}',
  tags: ['标签分组'],
  summary: '更新分组',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: {
    params: GroupIdParam,
    body: { content: { 'application/json': { schema: UpdateTagGroupBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagGroupSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '冲突' },
  },
})

tagGroups.openapi(updateGroupRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const body = c.req.valid('json')

  const group = await prisma.tagGroup.findUnique({ where: { id: groupId, deletedAt: null }, select: { id: true } })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  const [slugConflict, nameConflict] = await Promise.all([
    body.slug !== undefined
      ? prisma.tagGroup.findFirst({ where: { slug: body.slug, id: { not: groupId }, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
    body.name !== undefined
      ? prisma.tagGroup.findFirst({ where: { name: body.name, id: { not: groupId }, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
  ])
  if (slugConflict) return c.json({ code: 409, message: 'slug 已存在' }, 409)
  if (nameConflict) return c.json({ code: 409, message: 'name 已存在' }, 409)

  if (body.allowMultiple === false) {
    type ViolationRow = { entityId: string; entityType: string }
    const violations = await prisma.$queryRaw<ViolationRow[]>`
      SELECT et."entityId", et."entityType"
      FROM "EntityTag" et JOIN "Tag" t ON t.id = et."tagId"
      WHERE t."groupId" = ${groupId} AND et.status = 'active' AND t."deletedAt" IS NULL
      GROUP BY et."entityId", et."entityType" HAVING COUNT(*) > 1 LIMIT 1
    `
    if (violations.length > 0)
      return c.json({ code: 409, message: '当前已有实体持有该分组的多个标签，无法修改为不允许多选' }, 409)
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.tagGroup.update({
        where: { id: groupId },
        data: {
          ...(body.slug          !== undefined ? { slug:          body.slug }          : {}),
          ...(body.name          !== undefined ? { name:          body.name }          : {}),
          ...(body.description   !== undefined ? { description:   body.description }   : {}),
          ...(body.entityScopes  !== undefined ? { entityScopes:  body.entityScopes }  : {}),
          ...(body.allowMultiple !== undefined ? { allowMultiple: body.allowMultiple } : {}),
          ...(body.sortOrder     !== undefined ? { sortOrder:     body.sortOrder }     : {}),
        },
      })
      await emitEvent(tx, 'tag_group.updated', { groupId, slug: u.slug, name: u.name })
      return u
    })
    return c.json({ code: 0, data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), deletedAt: updated.deletedAt?.toISOString() ?? null } }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002')) return c.json({ code: 409, message: 'slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Update tag group error')
    throw error
  }
})

// ── DELETE /:groupId ──────────────────────────────────────────────────────────
const deleteGroupRoute = createRoute({
  method: 'delete', path: '/{groupId}',
  tags: ['标签分组'],
  summary: '删除分组（软删除；?permanent=true 硬删）',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: {
    params: GroupIdParam,
    query: z.object({
      force:     z.enum(['true', '1']).optional(),
      permanent: z.enum(['true', '1']).optional().openapi({ description: '硬删除（不可恢复，含 EntityTag 级联）' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '有关联数据' },
  },
})

tagGroups.openapi(deleteGroupRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const force     = c.req.query('force')     === 'true' || c.req.query('force')     === '1'
  const permanent = c.req.query('permanent') === 'true' || c.req.query('permanent') === '1'

  if (permanent) {
    // Hard delete — works whether group is already soft-deleted or still active
    const group = await prisma.tagGroup.findUnique({ where: { id: groupId }, select: { id: true, slug: true, name: true } })
    if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)
    await prisma.$transaction(async (tx) => {
      await tx.tagGroup.delete({ where: { id: groupId } })
      await emitEvent(tx, 'tag_group.deleted', { groupId, slug: group.slug, name: group.name, permanent: true })
    })
    return c.json({ code: 0, message: '已永久删除' }, 200)
  }

  const group = await prisma.tagGroup.findUnique({ where: { id: groupId, deletedAt: null }, select: { id: true, slug: true, name: true } })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  if (!force) {
    const usageCount = await prisma.entityTag.count({ where: { tag: { groupId }, status: 'active' } })
    if (usageCount > 0)
      return c.json({ code: 409, message: `该分组下共有 ${usageCount} 条实体关联，如需强制删除请添加 ?force=true` }, 409)
  }

  await prisma.$transaction(async (tx) => {
    await tx.tagGroup.update({ where: { id: groupId }, data: { deletedAt: new Date() } })
    await emitEvent(tx, 'tag_group.deleted', { groupId, slug: group.slug, name: group.name, permanent: false })
  })
  return c.json({ code: 0, message: '删除成功' }, 200)
})

// ── POST /:groupId/restore ────────────────────────────────────────────────────
const restoreGroupRoute = createRoute({
  method: 'post', path: '/{groupId}/restore',
  tags: ['标签分组'],
  summary: '恢复软删除分组',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: { params: GroupIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagGroupSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: 'slug 或 name 冲突' },
  },
})

tagGroups.openapi(restoreGroupRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const group = await prisma.tagGroup.findUnique({
    where: { id: groupId },
    select: { id: true, slug: true, name: true, deletedAt: true },
  })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)
  if (!group.deletedAt) return c.json({ code: 409, message: '该分组未被删除，无需恢复' }, 409)

  const [slugConflict, nameConflict] = await Promise.all([
    prisma.tagGroup.findFirst({ where: { slug: group.slug, deletedAt: null }, select: { id: true } }),
    prisma.tagGroup.findFirst({ where: { name: group.name, deletedAt: null }, select: { id: true } }),
  ])
  if (slugConflict) return c.json({ code: 409, message: `slug「${group.slug}」已被其他活跃分组占用，无法恢复` }, 409)
  if (nameConflict) return c.json({ code: 409, message: `名称「${group.name}」已被其他活跃分组占用，无法恢复` }, 409)

  const restored = await prisma.tagGroup.update({
    where: { id: groupId },
    data:  { deletedAt: null },
    include: { entityRules: true, _count: { select: { tags: { where: { deletedAt: null } } } } },
  })
  return c.json({ code: 0, data: { ...restored, createdAt: restored.createdAt.toISOString(), updatedAt: restored.updatedAt.toISOString(), deletedAt: null } }, 200)
})

// ── GET /:groupId/tags ────────────────────────────────────────────────────────
const listGroupTagsRoute = createRoute({
  method: 'get', path: '/{groupId}/tags',
  tags: ['标签分组'],
  summary: '获取分组内标签（分页）',
  request: {
    params: GroupIdParam,
    query: PaginationQuery.extend({
      onlyDeleted: z.enum(['true', 'false']).optional().openapi({ description: '仅返回软删除标签（回收站）' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(Paginated(TagSchema)) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagGroups.openapi(listGroupTagsRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const { page, pageSize, skip, take } = parsePagination(c.req.query())
  const onlyDeleted = c.req.query('onlyDeleted') === 'true'

  // Allow browsing deleted group's tags (e.g., restoring individual tags)
  const groupExists = await prisma.tagGroup.findUnique({ where: { id: groupId }, select: { id: true } })
  if (!groupExists) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  const where = {
    groupId,
    ...(onlyDeleted ? { deletedAt: { not: null } } : { deletedAt: null }),
  }
  const [items, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      include: { _count: { select: { entityTags: { where: { status: 'active' } } } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      skip, take,
    }),
    prisma.tag.count({ where }),
  ])
  return c.json({ code: 0, data: { items, total, page, pageSize } }, 200)
})

// ── PUT /:groupId/entity-rules ────────────────────────────────────────────────
const setEntityRulesRoute = createRoute({
  method: 'put', path: '/{groupId}/entity-rules',
  tags: ['标签分组'],
  summary: '设置实体类型规则',
  security: [{ BearerAuth: [] }],
  request: {
    params: GroupIdParam,
    body: { content: { 'application/json': { schema: EntityRulesBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(EntityRuleSchema)) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagGroups.openapi(setEntityRulesRoute, async (c) => {
  const { groupId } = c.req.valid('param')
  const { rules } = c.req.valid('json')

  const groupExists = await prisma.tagGroup.findUnique({ where: { id: groupId, deletedAt: null }, select: { id: true } })
  if (!groupExists) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  await prisma.$transaction([
    prisma.tagGroupEntityRule.deleteMany({ where: { groupId } }),
    prisma.tagGroupEntityRule.createMany({
      data: rules.map(r => ({ groupId, entityType: r.entityType, allowMultiple: r.allowMultiple })),
    }),
  ])
  const updated = await prisma.tagGroupEntityRule.findMany({ where: { groupId } })
  return c.json({ code: 0, data: updated }, 200)
})
