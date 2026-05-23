import { Hono } from 'hono'
import prisma from '../lib/db.js'
import { parsePagination } from '../lib/pagination.js'
import { generateSlug } from '../lib/slug.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'

const tags = new Hono()

const MAX_NAME_LENGTH = 50
const MAX_SLUG_LENGTH = 100
const MAX_DESC_LENGTH = 200
const MAX_DEPTH = 5
const SLUG_FORMAT = /^[a-z0-9][a-z0-9_-]*$/

// ── 层级工具 ─────────────────────────────────────────────────────

function buildPath(parentPath: string, slug: string): string {
  return `${parentPath}${slug}/`
}

/**
 * 校验 parentId：存在、同组、深度未超限、无循环。
 * currentTagPath 为 null 时（创建场景）跳过循环检测。
 */
async function validateParent(
  parentId: string,
  groupId: string,
  currentTagPath: string | null,
): Promise<{ parent: { id: string; path: string; depth: number } } | { error: string; status: 400 | 404 }> {
  const parent = await prisma.tag.findUnique({
    where: { id: parentId, deletedAt: null },
    select: { id: true, groupId: true, path: true, depth: true },
  })
  if (!parent) return { error: '父标签不存在', status: 404 }
  if (parent.groupId !== groupId) return { error: '父标签必须与当前标签同属一个分组', status: 400 }
  if (parent.depth >= MAX_DEPTH) return { error: `层级深度不能超过 ${MAX_DEPTH} 层`, status: 400 }

  // 循环检测：若被移动的标签是 parent 的祖先（parent.path 以 currentTag.path 开头），则拒绝
  if (currentTagPath && parent.path.startsWith(currentTagPath)) {
    return { error: '不能将标签设为其子孙标签的父标签（会形成循环）', status: 400 }
  }

  return { parent }
}

/* ── GET /resolve — 按 name/slug/alias 解析到 tag ───────────── */
// 注意：必须在 /:tagId 路由之前注册，避免被参数路由吃掉
tags.get('/resolve', async (c) => {
  const q       = c.req.query('q')?.trim()
  const groupId = c.req.query('groupId')   // 可选：限定 group 范围

  if (!q) return c.json({ code: 400, message: 'q 参数为必填项' }, 400)

  const groupFilter = groupId ? { groupId } : {}

  // 优先按 name 精确匹配
  const byName = await prisma.tag.findFirst({
    where: { name: q, deletedAt: null, ...groupFilter },
    include: { group: { select: { id: true, slug: true, name: true } } },
  })
  if (byName) return c.json({ code: 0, data: { tag: byName, matchedBy: 'name' as const } })

  // 按 slug 精确匹配
  const bySlug = await prisma.tag.findFirst({
    where: { slug: q, deletedAt: null, ...groupFilter },
    include: { group: { select: { id: true, slug: true, name: true } } },
  })
  if (bySlug) return c.json({ code: 0, data: { tag: bySlug, matchedBy: 'slug' as const } })

  // 按别名匹配（同 group 内 alias 唯一，可能有多个 group 的结果）
  const byAlias = await prisma.tagAlias.findFirst({
    where: {
      alias: q,
      tag:   { deletedAt: null, ...groupFilter },
    },
    include: {
      tag: { include: { group: { select: { id: true, slug: true, name: true } } } },
    },
  })
  if (byAlias) return c.json({ code: 0, data: { tag: byAlias.tag, matchedBy: 'alias' as const } })

  return c.json({ code: 404, message: '未找到匹配的标签' }, 404)
})

/* ── GET / — 列出标签（支持按分组、名称过滤、分页）──────────── */
tags.get('/', async (c) => {
  const { page, pageSize, skip, take } = parsePagination(c.req.query())
  const groupId  = c.req.query('groupId')
  const parentId = c.req.query('parentId')  // 'null' | actual id | undefined
  const q        = c.req.query('q')

  const where = {
    deletedAt: null,
    ...(groupId ? { groupId } : {}),
    ...(parentId === 'null'
      ? { parentId: null }
      : parentId ? { parentId } : {}),
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
      skip,
      take,
    }),
    prisma.tag.count({ where }),
  ])

  return c.json({ code: 0, data: { items, total, page, pageSize } })
})

/* ── GET /:tagId — 获取单个标签详情 ─────────────────────────── */
tags.get('/:tagId', async (c) => {
  const tagId = c.req.param('tagId')
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
  return c.json({ code: 0, data: tag })
})

/* ── GET /:tagId/descendants — 获取所有子孙标签 ─────────────── */
tags.get('/:tagId/descendants', async (c) => {
  const tagId = c.req.param('tagId')
  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { path: true },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  const items = await prisma.tag.findMany({
    where: {
      path:      { startsWith: tag.path },
      id:        { not: tagId },
      deletedAt: null,
    },
    include: {
      _count: { select: { entityTags: { where: { status: 'active' } } } },
    },
    orderBy: { path: 'asc' },
  })
  return c.json({ code: 0, data: { items, total: items.length } })
})

/* ── GET /:tagId/ancestors — 获取祖先链（从根到父，不含自身）── */
tags.get('/:tagId/ancestors', async (c) => {
  const tagId = c.req.param('tagId')
  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { parentId: true },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  const ancestors: { id: string; slug: string; name: string; depth: number }[] = []
  let currentParentId = tag.parentId
  while (currentParentId) {
    const parent = await prisma.tag.findUnique({
      where: { id: currentParentId },
      select: { id: true, slug: true, name: true, depth: true, parentId: true },
    })
    if (!parent) break
    ancestors.unshift(parent)
    currentParentId = parent.parentId
  }

  return c.json({ code: 0, data: ancestors })
})

/* ── POST / — 创建标签 ──────────────────────────────────────── */
tags.post('/', requireRole('admin'), async (c) => {
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!body.groupId || typeof body.groupId !== 'string')
    return c.json({ code: 400, message: 'groupId 为必填项' }, 400)
  if (!body.name || typeof body.name !== 'string' || !(body.name as string).trim())
    return c.json({ code: 400, message: 'name 为必填项' }, 400)

  const name = (body.name as string).trim()
  if (name.length > MAX_NAME_LENGTH)
    return c.json({ code: 400, message: `name 不能超过 ${MAX_NAME_LENGTH} 个字符` }, 400)

  if (body.description != null) {
    if (typeof body.description !== 'string')
      return c.json({ code: 400, message: 'description 必须为字符串' }, 400)
    if (body.description.length > MAX_DESC_LENGTH)
      return c.json({ code: 400, message: `description 不能超过 ${MAX_DESC_LENGTH} 个字符` }, 400)
  }

  if (body.sortOrder != null && (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder)))
    return c.json({ code: 400, message: 'sortOrder 必须为整数' }, 400)

  const group = await prisma.tagGroup.findUnique({
    where: { id: body.groupId as string, deletedAt: null },
    select: { id: true },
  })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  // ── parentId 校验 ──
  let parentPath = ''
  let depth = 0
  const rawParentId = body.parentId as string | undefined | null

  if (rawParentId) {
    if (typeof rawParentId !== 'string')
      return c.json({ code: 400, message: 'parentId 必须为字符串' }, 400)
    const result = await validateParent(rawParentId, body.groupId as string, null)
    if ('error' in result) return c.json({ code: result.status, message: result.error }, result.status)
    parentPath = result.parent.path
    depth = result.parent.depth + 1
  }

  // ── slug ──
  let slug: string
  if (body.slug != null) {
    if (typeof body.slug !== 'string' || !body.slug.trim())
      return c.json({ code: 400, message: 'slug 不能为空字符串' }, 400)
    slug = body.slug.trim()
    if (slug.length > MAX_SLUG_LENGTH)
      return c.json({ code: 400, message: `slug 不能超过 ${MAX_SLUG_LENGTH} 个字符` }, 400)
    if (!SLUG_FORMAT.test(slug))
      return c.json({ code: 400, message: 'slug 只能包含小写字母、数字、连字符和下划线，且必须以字母或数字开头' }, 400)
  } else {
    slug = generateSlug(name)
    if (slug.length > MAX_SLUG_LENGTH) slug = slug.slice(0, MAX_SLUG_LENGTH)
  }

  // 检查 name/slug 冲突（仅未软删除的记录）
  const [conflictName, conflictSlug] = await Promise.all([
    prisma.tag.findFirst({ where: { groupId: body.groupId as string, name, deletedAt: null }, select: { id: true } }),
    prisma.tag.findFirst({ where: { groupId: body.groupId as string, slug, deletedAt: null }, select: { id: true } }),
  ])
  if (conflictName) return c.json({ code: 409, message: '该分组内 name 已存在' }, 409)
  if (conflictSlug) {
    if (body.slug != null) return c.json({ code: 409, message: '该分组内 slug 已存在' }, 409)
    slug = `${slug.slice(0, MAX_SLUG_LENGTH - 9)}-${Date.now().toString(36)}`
  }

  const path = buildPath(parentPath, slug)

  try {
    const tag = await prisma.tag.create({
      data: {
        groupId:     body.groupId as string,
        parentId:    rawParentId || null,
        slug,
        name,
        path,
        depth,
        description: (body.description as string | undefined)?.trim() || null,
        sortOrder:   (body.sortOrder as number | undefined) ?? 0,
      },
    })
    return c.json({ code: 0, data: tag })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002'))
      return c.json({ code: 409, message: '该分组内 slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Create tag error')
    return c.json({ code: 500, message: '创建失败' }, 500)
  }
})

/* ── POST /:targetId/merge — 合并标签（same-group）────────── */
tags.post('/:targetId/merge', requireRole('admin'), async (c) => {
  const targetId = c.req.param('targetId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!Array.isArray(body.sourceIds) || body.sourceIds.length === 0)
    return c.json({ code: 400, message: 'sourceIds 必须为非空数组' }, 400)

  const rawIds = body.sourceIds as unknown[]
  if (!rawIds.every(id => typeof id === 'string' && (id as string).trim()))
    return c.json({ code: 400, message: 'sourceIds 每个元素必须为非空字符串' }, 400)

  const uniqueSourceIds = [...new Set(rawIds as string[])]

  if (uniqueSourceIds.includes(targetId))
    return c.json({ code: 400, message: 'sourceIds 不能包含 targetId 本身' }, 400)

  // 校验目标标签
  const target = await prisma.tag.findUnique({
    where: { id: targetId, deletedAt: null },
    select: { id: true, groupId: true, name: true, slug: true },
  })
  if (!target) return c.json({ code: 404, message: '目标标签不存在' }, 404)

  // 校验源标签：存在、同组、无子节点
  const sourceTags = await prisma.tag.findMany({
    where: { id: { in: uniqueSourceIds }, deletedAt: null },
    select: { id: true, groupId: true, _count: { select: { children: { where: { deletedAt: null } } } } },
  })
  if (sourceTags.length !== uniqueSourceIds.length) {
    const found = new Set(sourceTags.map(t => t.id))
    const missing = uniqueSourceIds.filter(id => !found.has(id))
    return c.json({ code: 404, message: `以下标签不存在：${missing.join(', ')}` }, 404)
  }
  const wrongGroup = sourceTags.filter(t => t.groupId !== target.groupId)
  if (wrongGroup.length > 0)
    return c.json({ code: 400, message: '所有源标签必须与目标标签属于同一分组' }, 400)

  const withChildren = sourceTags.find(t => t._count.children > 0)
  if (withChildren)
    return c.json({ code: 409, message: `标签「${withChildren.id}」存在子标签，请先处理子标签再合并` }, 409)

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. 把源标签的 EntityTag 迁移到目标标签，已存在则跳过
      const entityTagsMoved: number = await tx.$executeRaw`
        INSERT INTO "EntityTag" (
          "tagId","entityType","entityId","source","confidence",
          "status","createdAt","reviewedAt","reviewerId","reviewNote","previousStatus"
        )
        SELECT
          ${targetId},"entityType","entityId","source","confidence",
          "status","createdAt","reviewedAt","reviewerId","reviewNote","previousStatus"
        FROM "EntityTag"
        WHERE "tagId" = ANY(${uniqueSourceIds})
        ON CONFLICT ("tagId","entityType","entityId") DO NOTHING
      `

      // 2. 删除源标签原有的 EntityTag（EntityTagReview 级联删除）
      await tx.entityTag.deleteMany({ where: { tagId: { in: uniqueSourceIds } } })

      // 3. 迁移别名（跳过与目标标签已有别名/name/slug 冲突的）
      const targetExisting = await tx.tagAlias.findMany({
        where: { tagId: targetId },
        select: { alias: true },
      })
      const blocklist = new Set([...targetExisting.map(a => a.alias), target.name, target.slug])

      const sourceAliases = await tx.tagAlias.findMany({
        where: { tagId: { in: uniqueSourceIds } },
        select: { id: true, alias: true },
      })
      const toMove   = sourceAliases.filter(a => !blocklist.has(a.alias))
      const toDelete = sourceAliases.filter(a =>  blocklist.has(a.alias))

      if (toDelete.length > 0)
        await tx.tagAlias.deleteMany({ where: { id: { in: toDelete.map(a => a.id) } } })

      let aliasesMoved = 0
      if (toMove.length > 0) {
        await tx.tagAlias.updateMany({
          where: { id: { in: toMove.map(a => a.id) } },
          data:  { tagId: targetId },
        })
        aliasesMoved = toMove.length
      }

      // 4. 软删除源标签
      await tx.tag.updateMany({
        where: { id: { in: uniqueSourceIds } },
        data:  { deletedAt: new Date() },
      })

      // 5. 写入合并日志
      await tx.tagMergeLog.create({
        data: { targetTagId: targetId, sourceTagIds: uniqueSourceIds, entityTagsMoved, aliasesMoved },
      })

      return { entityTagsMoved, aliasesMoved }
    })

    return c.json({ code: 0, data: result })
  } catch (error: unknown) {
    logger.error({ err: error }, 'Merge tags error')
    return c.json({ code: 500, message: '合并失败' }, 500)
  }
})

/* ── POST /:tagId/move — 迁移标签到另一分组（含子孙）──────── */
tags.post('/:tagId/move', requireRole('admin'), async (c) => {
  const tagId = c.req.param('tagId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!body.targetGroupId || typeof body.targetGroupId !== 'string')
    return c.json({ code: 400, message: 'targetGroupId 为必填项' }, 400)

  const targetGroupId = body.targetGroupId as string

  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true, groupId: true, slug: true, path: true, depth: true },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
  if (tag.groupId === targetGroupId)
    return c.json({ code: 400, message: '目标分组与当前分组相同' }, 400)

  const targetGroup = await prisma.tagGroup.findUnique({
    where: { id: targetGroupId, deletedAt: null },
    include: { entityRules: true },
  })
  if (!targetGroup) return c.json({ code: 404, message: '目标分组不存在' }, 404)

  // 收集所有子孙节点
  const descendants = await prisma.tag.findMany({
    where: { path: { startsWith: tag.path }, id: { not: tagId }, deletedAt: null },
    select: { id: true, slug: true, name: true, path: true, depth: true },
  })
  const allMoving    = [tag, ...descendants]
  const allMovingIds = allMoving.map(t => t.id)

  // 校验 name/slug 冲突
  const [movingSlugs, movingNames] = [
    allMoving.map(t => t.slug),
    await prisma.tag.findMany({ where: { id: { in: allMovingIds } }, select: { name: true } }).then(r => r.map(t => t.name)),
  ]
  const conflicts = await prisma.tag.findMany({
    where: {
      groupId: targetGroupId, deletedAt: null,
      OR: [{ slug: { in: movingSlugs } }, { name: { in: movingNames } }],
    },
    select: { name: true, slug: true },
  })
  if (conflicts.length > 0)
    return c.json({
      code: 409,
      message: `目标分组已存在同名/同 slug 标签：${conflicts.map(c => c.name).join(', ')}`,
    }, 409)

  // 校验 entityScopes 兼容性
  if (targetGroup.entityScopes.length > 0) {
    type ETRow = { entityType: string }
    const usedTypes = await prisma.$queryRaw<ETRow[]>`
      SELECT DISTINCT et."entityType"
      FROM "EntityTag" et
      WHERE et."tagId" = ANY(${allMovingIds})
    `
    const incompatible = usedTypes.filter(r => !targetGroup.entityScopes.includes(r.entityType))
    if (incompatible.length > 0)
      return c.json({
        code: 409,
        message: `目标分组的 entityScopes 不包含以下实体类型：${incompatible.map(r => r.entityType).join(', ')}`,
      }, 409)
  }

  // 校验 allowMultiple 兼容性（仅当目标分组或某实体类型规则禁止多选时才检查）
  const forbidsMultiple = !targetGroup.allowMultiple || targetGroup.entityRules.some(r => !r.allowMultiple)
  if (forbidsMultiple && allMovingIds.length > 1) {
    type VRow = { entityId: string; entityType: string }
    const violations = await prisma.$queryRaw<VRow[]>`
      SELECT et."entityId", et."entityType"
      FROM "EntityTag" et
      WHERE et."tagId" = ANY(${allMovingIds})
        AND et.status = 'active'
      GROUP BY et."entityId", et."entityType"
      HAVING COUNT(*) > 1
      LIMIT 1
    `
    if (violations.length > 0)
      return c.json({
        code: 409,
        message: '目标分组不允许多选，但已有实体持有迁移子树中的多个标签',
      }, 409)
  }

  // 新路径：成为目标分组的根节点
  const oldPath = tag.path
  const newPath = `/${tag.slug}/`
  const depthDelta = -tag.depth   // tag 原深度 N → 新深度 0，子孙各减 N

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 更新 tag 本身
      const updatedTag = await tx.tag.update({
        where: { id: tagId },
        data: { groupId: targetGroupId, parentId: null, path: newPath, depth: 0 },
      })

      if (descendants.length > 0) {
        // 批量更新子孙的 groupId
        await tx.tag.updateMany({
          where: { id: { in: descendants.map(d => d.id) } },
          data:  { groupId: targetGroupId },
        })
        // 批量更新子孙的 path 和 depth
        await tx.$executeRaw`
          UPDATE "Tag"
          SET
            path  = REPLACE(path, ${oldPath}, ${newPath}),
            depth = depth + ${depthDelta}
          WHERE path LIKE ${oldPath + '%'}
            AND id != ${tagId}
            AND "deletedAt" IS NULL
        `
      }

      await tx.tagMoveLog.create({
        data: { tagId, fromGroupId: tag.groupId, toGroupId: targetGroupId, tagsMoved: allMoving.length },
      })

      return updatedTag
    })

    return c.json({ code: 0, data: { tag: updated, tagsMoved: allMoving.length } })
  } catch (error: unknown) {
    logger.error({ err: error }, 'Move tag error')
    return c.json({ code: 500, message: '迁移失败' }, 500)
  }
})

/* ── PATCH /:tagId — 更新标签 ───────────────────────────────── */
tags.patch('/:tagId', requireRole('admin'), async (c) => {
  const tagId = c.req.param('tagId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  const hasName        = Object.prototype.hasOwnProperty.call(body, 'name')
  const hasSlug        = Object.prototype.hasOwnProperty.call(body, 'slug')
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description')
  const hasSortOrder   = Object.prototype.hasOwnProperty.call(body, 'sortOrder')
  const hasParentId    = Object.prototype.hasOwnProperty.call(body, 'parentId')
  if (!hasName && !hasSlug && !hasDescription && !hasSortOrder && !hasParentId)
    return c.json({ code: 400, message: '至少需要传入 name、slug、description、sortOrder、parentId 之一' }, 400)

  if (hasName) {
    if (typeof body.name !== 'string' || !(body.name as string).trim())
      return c.json({ code: 400, message: 'name 不能为空' }, 400)
    if ((body.name as string).trim().length > MAX_NAME_LENGTH)
      return c.json({ code: 400, message: `name 不能超过 ${MAX_NAME_LENGTH} 个字符` }, 400)
  }
  if (hasSlug) {
    if (typeof body.slug !== 'string' || !(body.slug as string).trim())
      return c.json({ code: 400, message: 'slug 不能为空' }, 400)
    const s = (body.slug as string).trim()
    if (s.length > MAX_SLUG_LENGTH)
      return c.json({ code: 400, message: `slug 不能超过 ${MAX_SLUG_LENGTH} 个字符` }, 400)
    if (!SLUG_FORMAT.test(s))
      return c.json({ code: 400, message: 'slug 格式不合法' }, 400)
  }
  if (hasDescription && body.description !== null) {
    if (typeof body.description !== 'string')
      return c.json({ code: 400, message: 'description 必须为字符串或 null' }, 400)
    if (body.description.length > MAX_DESC_LENGTH)
      return c.json({ code: 400, message: `description 不能超过 ${MAX_DESC_LENGTH} 个字符` }, 400)
  }
  if (hasSortOrder && (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder)))
    return c.json({ code: 400, message: 'sortOrder 必须为整数' }, 400)

  const existing = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true, groupId: true, slug: true, path: true, depth: true, parentId: true },
  })
  if (!existing) return c.json({ code: 404, message: '标签不存在' }, 404)

  // 检查 name/slug 冲突
  const conflictChecks = [
    hasName
      ? prisma.tag.findFirst({ where: { groupId: existing.groupId, name: (body.name as string).trim(), id: { not: tagId }, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
    hasSlug
      ? prisma.tag.findFirst({ where: { groupId: existing.groupId, slug: (body.slug as string).trim(), id: { not: tagId }, deletedAt: null }, select: { id: true } })
      : Promise.resolve(null),
  ]
  const [nameConflict, slugConflict] = await Promise.all(conflictChecks)
  if (nameConflict) return c.json({ code: 409, message: '该分组内 name 已存在' }, 409)
  if (slugConflict) return c.json({ code: 409, message: '该分组内 slug 已存在' }, 409)

  // ── 计算新 path/depth（当 slug 或 parentId 变化时需要更新整个子树）──
  const newSlug     = hasSlug ? (body.slug as string).trim() : existing.slug
  const newParentId = hasParentId ? (body.parentId as string | null) : existing.parentId

  let newParentPath = ''
  let newDepth      = 0

  if (newParentId) {
    if (typeof newParentId !== 'string')
      return c.json({ code: 400, message: 'parentId 必须为字符串或 null' }, 400)
    const result = await validateParent(newParentId, existing.groupId, existing.path)
    if ('error' in result) return c.json({ code: result.status, message: result.error }, result.status)
    newParentPath = result.parent.path
    newDepth      = result.parent.depth + 1
  }

  const newPath   = buildPath(newParentPath, newSlug)
  const oldPath   = existing.path
  const depthDelta = newDepth - existing.depth
  const pathChanged = newPath !== oldPath

  try {
    const tag = await prisma.$transaction(async (tx) => {
      const updated = await tx.tag.update({
        where: { id: tagId },
        data: {
          ...(hasName        ? { name: (body.name as string).trim() }               : {}),
          ...(hasSlug        ? { slug: newSlug }                                    : {}),
          ...(hasDescription ? { description: body.description as string | null }   : {}),
          ...(hasSortOrder   ? { sortOrder: body.sortOrder as number }              : {}),
          ...(hasParentId    ? { parentId: newParentId }                            : {}),
          ...(pathChanged    ? { path: newPath, depth: newDepth }                   : {}),
        },
      })

      // 更新子孙节点的 path 和 depth
      if (pathChanged) {
        await tx.$executeRaw`
          UPDATE "Tag"
          SET
            path  = REPLACE(path, ${oldPath}, ${newPath}),
            depth = depth + ${depthDelta}
          WHERE path LIKE ${oldPath + '%'}
            AND id != ${tagId}
        `
      }

      return updated
    })

    return c.json({ code: 0, data: tag })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002'))
      return c.json({ code: 409, message: '该分组内 slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Update tag error')
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

/* ── DELETE /:tagId — 软删除标签 ────────────────────────────── */
tags.delete('/:tagId', requireRole('admin'), async (c) => {
  const tagId = c.req.param('tagId')
  const force = c.req.query('force') === 'true' || c.req.query('force') === '1'

  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    include: { _count: { select: { entityTags: { where: { status: 'active' } } } } },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  if (tag._count.entityTags > 0 && !force) {
    return c.json({
      code: 409,
      message: `该标签正被 ${tag._count.entityTags} 个实体使用，如需强制删除请添加 ?force=true`,
    }, 409)
  }

  // 软删除：仅置 deletedAt。子标签的 parentId 由 DB FK onDelete: SetNull 自动清空。
  await prisma.tag.update({
    where: { id: tagId },
    data:  { deletedAt: new Date() },
  })
  return c.json({ code: 0, message: '删除成功' })
})

export { tags }
