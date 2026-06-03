/**
 * 标签高级操作路由
 *   POST /:targetId/merge  — 合并（same-group）
 *   POST /:tagId/move      — 跨组迁移（含子孙）
 */
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../../lib/router.js'
import prisma from '../../lib/db.js'
import logger from '../../lib/logger.js'
import { requireRole } from '../../middleware/auth.js'
import { emitEvent } from '../../lib/events.js'
import { TagSchema, ApiError, okData } from '../../lib/schemas.js'

export const tagsOperations = createRouter()

const MergeBody = z.object({
  sourceIds: z.array(z.string().min(1)).min(1).openapi({ description: '要合并进 target 的源标签 ID 列表' }),
})

const MoveBody = z.object({
  targetGroupId: z.string().min(1).openapi({ description: '目标分组 ID' }),
  newParentId:   z.string().nullable().optional().openapi({ description: '目标分组内的父节点 ID，null 表示成为根节点' }),
})

// ── POST /:targetId/merge ─────────────────────────────────────────────────────
const mergeTagRoute = createRoute({
  method: 'post', path: '/{targetId}/merge',
  tags: ['标签'],
  summary: '合并标签（同分组）',
  description: '将多个源标签合并到目标标签，迁移 EntityTag 和 Alias，软删除源标签。源标签不能有子节点。',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ targetId: z.string().min(1) }),
    body: { content: { 'application/json': { schema: MergeBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.object({ entityTagsMoved: z.number().int(), aliasesMoved: z.number().int() })) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '标签不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '冲突（如源标签有子节点）' },
  },
})

tagsOperations.use('/:targetId/merge', requireRole('admin'))
tagsOperations.openapi(mergeTagRoute, async (c) => {
  const { targetId } = c.req.valid('param')
  const { sourceIds: rawSourceIds } = c.req.valid('json')

  const uniqueSourceIds = [...new Set(rawSourceIds)]
  if (uniqueSourceIds.includes(targetId))
    return c.json({ code: 400, message: 'sourceIds 不能包含 targetId 本身' }, 400)

  const target = await prisma.tag.findUnique({
    where: { id: targetId, deletedAt: null },
    select: { id: true, groupId: true, name: true, slug: true, group: { select: { slug: true } } },
  })
  if (!target) return c.json({ code: 404, message: '目标标签不存在' }, 404)

  const sourceTags = await prisma.tag.findMany({
    where: { id: { in: uniqueSourceIds }, deletedAt: null },
    select: { id: true, groupId: true, name: true, _count: { select: { children: { where: { deletedAt: null } } } } },
  })
  if (sourceTags.length !== uniqueSourceIds.length) {
    const missing = uniqueSourceIds.filter(id => !sourceTags.find(t => t.id === id))
    return c.json({ code: 404, message: `以下标签不存在：${missing.join(', ')}` }, 404)
  }
  if (sourceTags.some(t => t.groupId !== target.groupId))
    return c.json({ code: 400, message: '所有源标签必须与目标标签属于同一分组' }, 400)
  const withChildren = sourceTags.find(t => t._count.children > 0)
  if (withChildren)
    return c.json({ code: 409, message: `标签「${withChildren.id}」存在子标签，请先处理子标签再合并` }, 409)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const entityTagsMoved: number = await tx.$executeRaw`
        INSERT INTO "EntityTag" ("tagId","entityType","entityId","source","confidence","status","createdAt","reviewedAt","reviewerId","reviewNote","previousStatus")
        SELECT ${targetId},"entityType","entityId","source","confidence","status","createdAt","reviewedAt","reviewerId","reviewNote","previousStatus"
        FROM "EntityTag" WHERE "tagId" = ANY(${uniqueSourceIds})
        ON CONFLICT ("tagId","entityType","entityId") DO NOTHING
      `
      await tx.entityTag.deleteMany({ where: { tagId: { in: uniqueSourceIds } } })

      const targetExisting = await tx.tagAlias.findMany({ where: { tagId: targetId }, select: { alias: true } })
      const blocklist = new Set([...targetExisting.map(a => a.alias), target.name, target.slug])
      const sourceAliases = await tx.tagAlias.findMany({ where: { tagId: { in: uniqueSourceIds } }, select: { id: true, alias: true } })
      const toMove   = sourceAliases.filter(a => !blocklist.has(a.alias))
      const toDelete = sourceAliases.filter(a =>  blocklist.has(a.alias))

      if (toDelete.length > 0) await tx.tagAlias.deleteMany({ where: { id: { in: toDelete.map(a => a.id) } } })
      let aliasesMoved = 0
      if (toMove.length > 0) {
        await tx.tagAlias.updateMany({ where: { id: { in: toMove.map(a => a.id) } }, data: { tagId: targetId } })
        aliasesMoved = toMove.length
      }
      await tx.tag.updateMany({ where: { id: { in: uniqueSourceIds } }, data: { deletedAt: new Date() } })
      await tx.tagMergeLog.create({
        data: {
          targetTagId: targetId,
          targetTagName: target.name,
          targetTagSlug: target.slug,
          targetGroupSlug: target.group.slug,
          sourceTagIds: uniqueSourceIds,
          sourceTagNames: sourceTags.map(t => t.name),
          entityTagsMoved,
          aliasesMoved,
        },
      })
      await emitEvent(tx, 'tag.merged', { targetTagId: targetId, sourceTagIds: uniqueSourceIds, groupId: target.groupId, entityTagsMoved, aliasesMoved })
      return { entityTagsMoved, aliasesMoved }
    })
    return c.json({ code: 0, data: result }, 200)
  } catch (error: unknown) {
    logger.error({ err: error }, 'Merge tags error')
    throw error
  }
})

// ── POST /:tagId/move ─────────────────────────────────────────────────────────
const moveTagRoute = createRoute({
  method: 'post', path: '/{tagId}/move',
  tags: ['标签'],
  summary: '迁移标签到另一分组（含子孙）',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ tagId: z.string().min(1) }),
    body: { content: { 'application/json': { schema: MoveBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.object({ tag: TagSchema, tagsMoved: z.number().int() })) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '冲突' },
  },
})

tagsOperations.use('/:tagId/move', requireRole('admin'))
tagsOperations.openapi(moveTagRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const { targetGroupId } = c.req.valid('json')

  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true, groupId: true, slug: true, name: true, path: true, depth: true, group: { select: { slug: true } } },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
  if (tag.groupId === targetGroupId) return c.json({ code: 400, message: '目标分组与当前分组相同' }, 400)

  const targetGroup = await prisma.tagGroup.findUnique({ where: { id: targetGroupId, deletedAt: null }, include: { entityRules: true } })
  if (!targetGroup) return c.json({ code: 404, message: '目标分组不存在' }, 404)

  const descendants  = await prisma.tag.findMany({ where: { path: { startsWith: tag.path }, id: { not: tagId }, deletedAt: null }, select: { id: true, slug: true, name: true, path: true, depth: true } })
  const allMoving    = [tag, ...descendants]
  const allMovingIds = allMoving.map(t => t.id)

  const movingSlugs = allMoving.map(t => t.slug)
  const movingNames = await prisma.tag.findMany({ where: { id: { in: allMovingIds } }, select: { name: true } }).then(r => r.map(t => t.name))
  const conflicts = await prisma.tag.findMany({ where: { groupId: targetGroupId, deletedAt: null, OR: [{ slug: { in: movingSlugs } }, { name: { in: movingNames } }] }, select: { name: true, slug: true } })
  if (conflicts.length > 0)
    return c.json({ code: 409, message: `目标分组已存在同名/同 slug 标签：${conflicts.map(c => c.name).join(', ')}` }, 409)

  if (targetGroup.entityScopes.length > 0) {
    type ETRow = { entityType: string }
    const usedTypes = await prisma.$queryRaw<ETRow[]>`SELECT DISTINCT et."entityType" FROM "EntityTag" et WHERE et."tagId" = ANY(${allMovingIds})`
    const incompatible = usedTypes.filter(r => !targetGroup.entityScopes.includes(r.entityType))
    if (incompatible.length > 0)
      return c.json({ code: 409, message: `目标分组的 entityScopes 不包含以下实体类型：${incompatible.map(r => r.entityType).join(', ')}` }, 409)
  }

  const forbidsMultiple = !targetGroup.allowMultiple || targetGroup.entityRules.some(r => !r.allowMultiple)
  if (forbidsMultiple && allMovingIds.length > 1) {
    type VRow = { entityId: string; entityType: string }
    const violations = await prisma.$queryRaw<VRow[]>`
      SELECT et."entityId", et."entityType" FROM "EntityTag" et
      WHERE et."tagId" = ANY(${allMovingIds}) AND et.status = 'active'
      GROUP BY et."entityId", et."entityType" HAVING COUNT(*) > 1 LIMIT 1
    `
    if (violations.length > 0)
      return c.json({ code: 409, message: '目标分组不允许多选，但已有实体持有迁移子树中的多个标签' }, 409)
  }

  const oldPath  = tag.path
  // 物化路径无前导斜杠（buildPath = `${parentPath}${slug}/`）；移动后成为目标组根节点
  const newPath  = `${tag.slug}/`
  const depthDelta = -tag.depth

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const updatedTag = await tx.tag.update({ where: { id: tagId }, data: { groupId: targetGroupId, parentId: null, path: newPath, depth: 0 } })
      if (descendants.length > 0) {
        await tx.tag.updateMany({ where: { id: { in: descendants.map(d => d.id) } }, data: { groupId: targetGroupId } })
        // 锚定前缀替换：只换 path 开头的 oldPath，避免 REPLACE 子串全局替换损坏后代路径（#131）。
        // substring(path FROM len(oldPath)+1) 取后代相对 oldPath 的尾段，再拼上 newPath。
        await tx.$executeRaw`
          UPDATE "Tag" SET path = ${newPath} || substr(path, ${oldPath.length + 1}::int), depth = depth + ${depthDelta}
          WHERE path LIKE ${oldPath + '%'} AND id != ${tagId} AND "deletedAt" IS NULL
        `
      }
      await tx.tagMoveLog.create({
        data: {
          tagId,
          tagName: tag.name,
          tagSlug: tag.slug,
          fromGroupId: tag.groupId,
          fromGroupSlug: tag.group.slug,
          toGroupId: targetGroupId,
          toGroupSlug: targetGroup.slug,
          tagsMoved: allMoving.length,
        },
      })
      await emitEvent(tx, 'tag.moved', { tagId, fromGroupId: tag.groupId, toGroupId: targetGroupId, tagsMoved: allMoving.length })
      return updatedTag
    })
    return c.json({ code: 0, data: { tag: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), deletedAt: updated.deletedAt?.toISOString() ?? null }, tagsMoved: allMoving.length } }, 200)
  } catch (error: unknown) {
    logger.error({ err: error }, 'Move tag error')
    throw error
  }
})
