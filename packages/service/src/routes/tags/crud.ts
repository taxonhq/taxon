/**
 * 标签 CRUD 变更路由
 *   POST /
 *   PATCH /:tagId
 *   DELETE /:tagId
 */
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../../lib/router.js'
import prisma from '../../lib/db.js'
import { generateSlug } from '../../lib/slug.js'
import { isPrismaError } from '../../lib/errors.js'
import logger from '../../lib/logger.js'
import { requireRole } from '../../middleware/auth.js'
import { emitEvent } from '../../lib/events.js'
import { CreateTagBody, UpdateTagBody, TagSchema, ApiError, OkMessage, okData } from '../../lib/schemas.js'
import { MAX_SLUG_LENGTH, buildPath, validateParent } from './helpers.js'

export const tagsCrud = createRouter()

const TagIdParam = z.object({ tagId: z.string().min(1).openapi({ description: '标签 ID' }) })

// ── POST / ────────────────────────────────────────────────────────────────────
const createTagRoute = createRoute({
  method: 'post', path: '/',
  tags: ['标签'],
  summary: '创建标签',
  security: [{ BearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: CreateTagBody } }, required: true } },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagSchema) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '分组不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '冲突' },
  },
})

tagsCrud.use('/', requireRole('admin'))
tagsCrud.openapi(createTagRoute, async (c) => {
  const { groupId, name, slug: slugInput, description, parentId: rawParentId, sortOrder } = c.req.valid('json')

  const group = await prisma.tagGroup.findUnique({ where: { id: groupId, deletedAt: null }, select: { id: true } })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  let parentPath = '', depth = 0
  if (rawParentId) {
    const result = await validateParent(rawParentId, groupId, null)
    if ('error' in result) return c.json({ code: result.status, message: result.error }, result.status as 400 | 404 | 409)
    parentPath = result.parent.path
    depth = result.parent.depth + 1
  }

  let slug = slugInput ?? generateSlug(name)
  if (slug.length > MAX_SLUG_LENGTH) slug = slug.slice(0, MAX_SLUG_LENGTH)

  const [conflictName, conflictSlug] = await Promise.all([
    prisma.tag.findFirst({ where: { groupId, name, deletedAt: null }, select: { id: true } }),
    prisma.tag.findFirst({ where: { groupId, slug, deletedAt: null }, select: { id: true } }),
  ])
  if (conflictName) return c.json({ code: 409, message: '该分组内 name 已存在' }, 409)
  if (conflictSlug) {
    if (slugInput) return c.json({ code: 409, message: '该分组内 slug 已存在' }, 409)
    slug = `${slug.slice(0, MAX_SLUG_LENGTH - 9)}-${Date.now().toString(36)}`
  }

  const path = buildPath(parentPath, slug)
  try {
    const tag = await prisma.$transaction(async (tx) => {
      const created = await tx.tag.create({
        data: { groupId, parentId: rawParentId ?? null, slug, name, path, depth, description: description?.trim() || null, sortOrder },
      })
      await emitEvent(tx, 'tag.created', { tagId: created.id, groupId, slug: created.slug, name: created.name })
      return created
    })
    return c.json({ code: 0, data: { ...tag, createdAt: tag.createdAt.toISOString(), updatedAt: tag.updatedAt.toISOString(), deletedAt: tag.deletedAt?.toISOString() ?? null } }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002')) return c.json({ code: 409, message: '该分组内 slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Create tag error')
    throw error
  }
})

// ── PATCH /:tagId ─────────────────────────────────────────────────────────────
const updateTagRoute = createRoute({
  method: 'patch', path: '/{tagId}',
  tags: ['标签'],
  summary: '更新标签',
  security: [{ BearerAuth: [] }],
  request: {
    params: TagIdParam,
    body: { content: { 'application/json': { schema: UpdateTagBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagSchema) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '冲突' },
  },
})

tagsCrud.use('/:tagId', requireRole('admin'))
tagsCrud.openapi(updateTagRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const body = c.req.valid('json')
  const { name, slug: newSlugInput, description, sortOrder } = body
  const hasParentId = 'parentId' in body

  if (name === undefined && newSlugInput === undefined && description === undefined && sortOrder === undefined && !hasParentId)
    return c.json({ code: 400, message: '至少需要传入 name、slug、description、sortOrder、parentId 之一' }, 400)

  const existing = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true, groupId: true, slug: true, path: true, depth: true, parentId: true },
  })
  if (!existing) return c.json({ code: 404, message: '标签不存在' }, 404)

  const [nameConflict, slugConflict] = await Promise.all([
    name !== undefined
      ? prisma.tag.findFirst({ where: { groupId: existing.groupId, name, id: { not: tagId }, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
    newSlugInput !== undefined
      ? prisma.tag.findFirst({ where: { groupId: existing.groupId, slug: newSlugInput, id: { not: tagId }, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
  ])
  if (nameConflict) return c.json({ code: 409, message: '该分组内 name 已存在' }, 409)
  if (slugConflict) return c.json({ code: 409, message: '该分组内 slug 已存在' }, 409)

  const newSlug     = newSlugInput ?? existing.slug
  const newParentId = hasParentId ? (body.parentId ?? null) : existing.parentId
  let newParentPath = '', newDepth = 0

  if (newParentId) {
    const result = await validateParent(newParentId, existing.groupId, existing.path)
    if ('error' in result) return c.json({ code: result.status, message: result.error }, result.status as 400 | 404 | 409)
    newParentPath = result.parent.path
    newDepth      = result.parent.depth + 1
  }

  const newPath    = buildPath(newParentPath, newSlug)
  const oldPath    = existing.path
  const depthDelta = newDepth - existing.depth
  const pathChanged = newPath !== oldPath

  try {
    const tag = await prisma.$transaction(async (tx) => {
      const updated = await tx.tag.update({
        where: { id: tagId },
        data: {
          ...(name !== undefined         ? { name }                                  : {}),
          ...(newSlugInput !== undefined  ? { slug: newSlug }                        : {}),
          ...(description !== undefined   ? { description: description ?? null }     : {}),
          ...(sortOrder !== undefined     ? { sortOrder }                            : {}),
          ...(hasParentId                 ? { parentId: newParentId }                : {}),
          ...(pathChanged                 ? { path: newPath, depth: newDepth }       : {}),
        },
      })
      if (pathChanged) {
        // 锚定前缀替换（#131）：避免 REPLACE 子串全局替换损坏后代路径；
        // 并补 "deletedAt" IS NULL，与 move 一致，不改写软删除后代。
        // path 仅组内唯一，必须限定 groupId，否则会改写其它分组里同前缀标签的 path（#146）。
        await tx.$executeRaw`
          UPDATE "Tag" SET path = ${newPath} || substr(path, ${oldPath.length + 1}::int), depth = depth + ${depthDelta}
          WHERE path LIKE ${oldPath + '%'} AND id != ${tagId} AND "groupId" = ${existing.groupId} AND "deletedAt" IS NULL
        `
      }
      await emitEvent(tx, 'tag.updated', { tagId, groupId: existing.groupId, slug: updated.slug, name: updated.name })
      return updated
    })
    return c.json({ code: 0, data: { ...tag, createdAt: tag.createdAt.toISOString(), updatedAt: tag.updatedAt.toISOString(), deletedAt: tag.deletedAt?.toISOString() ?? null } }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002')) return c.json({ code: 409, message: '该分组内 slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Update tag error')
    throw error
  }
})

// ── DELETE /:tagId ────────────────────────────────────────────────────────────
const deleteTagRoute = createRoute({
  method: 'delete', path: '/{tagId}',
  tags: ['标签'],
  summary: '删除标签（软删除；?permanent=true 硬删）',
  security: [{ BearerAuth: [] }],
  request: {
    params: TagIdParam,
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

tagsCrud.openapi(deleteTagRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const force     = c.req.query('force')     === 'true' || c.req.query('force')     === '1'
  const permanent = c.req.query('permanent') === 'true' || c.req.query('permanent') === '1'

  if (permanent) {
    const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true, groupId: true, slug: true, name: true } })
    if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
    await prisma.$transaction(async (tx) => {
      await tx.tag.delete({ where: { id: tagId } })
      await emitEvent(tx, 'tag.deleted', { tagId, groupId: tag.groupId, slug: tag.slug, name: tag.name, permanent: true })
    })
    return c.json({ code: 0, message: '已永久删除' }, 200)
  }

  const tag = await prisma.tag.findUnique({ where: { id: tagId, deletedAt: null }, select: { id: true, groupId: true, slug: true, name: true } })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  if (!force) {
    const [usageCount, childCount] = await Promise.all([
      prisma.entityTag.count({ where: { tagId, status: 'active' } }),
      prisma.tag.count({ where: { parentId: tagId, deletedAt: null } }),
    ])
    if (usageCount > 0) return c.json({ code: 409, message: `该标签共有 ${usageCount} 条实体关联，如需强制删除请添加 ?force=true` }, 409)
    if (childCount > 0) return c.json({ code: 409, message: `该标签有 ${childCount} 个子标签，如需强制删除请添加 ?force=true` }, 409)
  }

  await prisma.$transaction(async (tx) => {
    await tx.tag.update({ where: { id: tagId }, data: { deletedAt: new Date() } })
    await emitEvent(tx, 'tag.deleted', { tagId, groupId: tag.groupId, slug: tag.slug, name: tag.name, permanent: false })
  })
  return c.json({ code: 0, message: '删除成功' }, 200)
})

// ── POST /:tagId/restore ──────────────────────────────────────────────────────
const restoreTagRoute = createRoute({
  method: 'post', path: '/{tagId}/restore',
  tags: ['标签'],
  summary: '恢复软删除标签',
  security: [{ BearerAuth: [] }],
  request: { params: TagIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: 'slug 或 name 冲突' },
  },
})

tagsCrud.use('/:tagId/restore', requireRole('admin'))
tagsCrud.openapi(restoreTagRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
    select: { id: true, groupId: true, slug: true, name: true, deletedAt: true },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
  if (!tag.deletedAt) return c.json({ code: 409, message: '该标签未被删除，无需恢复' }, 409)

  const [slugConflict, nameConflict] = await Promise.all([
    prisma.tag.findFirst({ where: { groupId: tag.groupId, slug: tag.slug, deletedAt: null }, select: { id: true } }),
    prisma.tag.findFirst({ where: { groupId: tag.groupId, name: tag.name, deletedAt: null }, select: { id: true } }),
  ])
  if (slugConflict) return c.json({ code: 409, message: `slug「${tag.slug}」在该分组内已被其他活跃标签占用，无法恢复` }, 409)
  if (nameConflict) return c.json({ code: 409, message: `名称「${tag.name}」在该分组内已被其他活跃标签占用，无法恢复` }, 409)

  const restored = await prisma.tag.update({
    where: { id: tagId },
    data:  { deletedAt: null },
    include: { _count: { select: { entityTags: { where: { status: 'active' } } } } },
  })
  return c.json({ code: 0, data: { ...restored, createdAt: restored.createdAt.toISOString(), updatedAt: restored.updatedAt.toISOString(), deletedAt: null } }, 200)
})
