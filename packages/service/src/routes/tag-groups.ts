import { Hono } from 'hono'
import prisma from '../lib/db.js'
import { parsePagination } from '../lib/pagination.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'

const tagGroups = new Hono()

const MAX_SLUG_LENGTH = 50
const MAX_NAME_LENGTH = 50
const MAX_DESC_LENGTH = 200
const SLUG_FORMAT = /^[a-z0-9][a-z0-9_-]*$/

function validateEntityScopes(scopes: string[]): string | null {
  const invalid = scopes.filter(s => typeof s !== 'string' || !s.trim())
  if (invalid.length > 0) return 'entityScopes 每个元素必须为非空字符串'
  return null
}

/* ── GET / — 列出分组 ────────────────────────────────────────── */
tagGroups.get('/', async (c) => {
  const { page, pageSize, skip, take } = parsePagination(c.req.query())
  const scopes = c.req.queries('scope') ?? []

  // scope 过滤：返回 entityScopes 包含任一指定类型（OR）或为通用（空数组）的分组
  const where = {
    deletedAt: null,
    ...(scopes.length > 0
      ? {
          OR: [
            { entityScopes: scopes.length === 1 ? { has: scopes[0] } : { hasSome: scopes } },
            { entityScopes: { isEmpty: true } },
          ],
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    prisma.tagGroup.findMany({
      where,
      include: {
        _count: { select: { tags: { where: { deletedAt: null } } } },
        entityRules: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      skip,
      take,
    }),
    prisma.tagGroup.count({ where }),
  ])

  return c.json({ code: 0, data: { items, total, page, pageSize } })
})

/* ── GET /:groupId — 获取分组详情 ───────────────────────────── */
tagGroups.get('/:groupId', async (c) => {
  const groupId = c.req.param('groupId')
  const group = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    include: { entityRules: true },
  })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)
  return c.json({ code: 0, data: group })
})

/* ── GET /:groupId/tree — 返回分组内完整标签树 ──────────────── */
tagGroups.get('/:groupId/tree', async (c) => {
  const groupId = c.req.param('groupId')
  const group = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    select: { id: true },
  })
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

  // 在内存里构建树结构
  type TagNode = (typeof allTags)[number] & { children: TagNode[] }
  const map = new Map<string, TagNode>(
    allTags.map(t => [t.id, { ...t, children: [] }]),
  )
  const roots: TagNode[] = []
  for (const tag of allTags) {
    const node = map.get(tag.id)!
    if (tag.parentId && map.has(tag.parentId)) {
      map.get(tag.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return c.json({ code: 0, data: roots })
})

/* ── POST / — 创建分组 ──────────────────────────────────────── */
tagGroups.post('/', requireRole('admin'), async (c) => {
  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!body.slug || typeof body.slug !== 'string')
    return c.json({ code: 400, message: 'slug 为必填项' }, 400)
  if (!body.name || typeof body.name !== 'string')
    return c.json({ code: 400, message: 'name 为必填项' }, 400)

  const slug = (body.slug as string).trim()
  const name = (body.name as string).trim()

  if (slug.length > MAX_SLUG_LENGTH)
    return c.json({ code: 400, message: `slug 不能超过 ${MAX_SLUG_LENGTH} 个字符` }, 400)
  if (!SLUG_FORMAT.test(slug))
    return c.json({ code: 400, message: 'slug 只能包含小写字母、数字、连字符和下划线，且必须以字母或数字开头' }, 400)
  if (name.length > MAX_NAME_LENGTH)
    return c.json({ code: 400, message: `name 不能超过 ${MAX_NAME_LENGTH} 个字符` }, 400)
  if (body.description && typeof body.description === 'string' && body.description.length > MAX_DESC_LENGTH)
    return c.json({ code: 400, message: `description 不能超过 ${MAX_DESC_LENGTH} 个字符` }, 400)

  const entityScopes: string[] = Array.isArray(body.entityScopes) ? body.entityScopes as string[] : []
  const scopeError = validateEntityScopes(entityScopes)
  if (scopeError) return c.json({ code: 400, message: scopeError }, 400)

  // 冲突检查（仅未软删除）
  const [conflictSlug, conflictName] = await Promise.all([
    prisma.tagGroup.findFirst({ where: { slug, deletedAt: null }, select: { id: true } }),
    prisma.tagGroup.findFirst({ where: { name, deletedAt: null }, select: { id: true } }),
  ])
  if (conflictSlug) return c.json({ code: 409, message: 'slug 已存在' }, 409)
  if (conflictName) return c.json({ code: 409, message: 'name 已存在' }, 409)

  try {
    const group = await prisma.tagGroup.create({
      data: {
        slug,
        name,
        description:   body.description as string | undefined,
        entityScopes,
        allowMultiple: (body.allowMultiple ?? true) as boolean,
        sortOrder:     (body.sortOrder ?? 0) as number,
      },
    })
    return c.json({ code: 0, data: group })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002'))
      return c.json({ code: 409, message: 'slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Create tag group error')
    return c.json({ code: 500, message: '创建失败' }, 500)
  }
})

/* ── PATCH /:groupId — 更新分组（支持 slug）────────────────── */
tagGroups.patch('/:groupId', requireRole('admin'), async (c) => {
  const groupId = c.req.param('groupId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  const group = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    select: { id: true },
  })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  // 字段校验
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || !(body.slug as string).trim())
      return c.json({ code: 400, message: 'slug 不能为空' }, 400)
    const s = (body.slug as string).trim()
    if (s.length > MAX_SLUG_LENGTH)
      return c.json({ code: 400, message: `slug 不能超过 ${MAX_SLUG_LENGTH} 个字符` }, 400)
    if (!SLUG_FORMAT.test(s))
      return c.json({ code: 400, message: 'slug 格式不合法' }, 400)
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || !(body.name as string).trim()))
    return c.json({ code: 400, message: 'name 不能为空' }, 400)
  if (body.description != null && typeof body.description === 'string' && body.description.length > MAX_DESC_LENGTH)
    return c.json({ code: 400, message: `description 不能超过 ${MAX_DESC_LENGTH} 个字符` }, 400)
  if (body.entityScopes !== undefined) {
    if (!Array.isArray(body.entityScopes))
      return c.json({ code: 400, message: 'entityScopes 必须为数组' }, 400)
    const scopeError = validateEntityScopes(body.entityScopes as string[])
    if (scopeError) return c.json({ code: 400, message: scopeError }, 400)
  }

  // 冲突检查（排除自身，排除软删除）
  const conflictChecks: Promise<{ id: string } | null>[] = []
  if (body.slug !== undefined) {
    conflictChecks.push(
      prisma.tagGroup.findFirst({
        where: { slug: (body.slug as string).trim(), id: { not: groupId }, deletedAt: null },
        select: { id: true },
      })
    )
  } else {
    conflictChecks.push(Promise.resolve(null))
  }
  if (body.name !== undefined) {
    conflictChecks.push(
      prisma.tagGroup.findFirst({
        where: { name: (body.name as string).trim(), id: { not: groupId }, deletedAt: null },
        select: { id: true },
      })
    )
  } else {
    conflictChecks.push(Promise.resolve(null))
  }
  const [slugConflict, nameConflict] = await Promise.all(conflictChecks)
  if (slugConflict) return c.json({ code: 409, message: 'slug 已存在' }, 409)
  if (nameConflict) return c.json({ code: 409, message: 'name 已存在' }, 409)

  // allowMultiple false 变更时，校验现有数据不违反约束
  if (body.allowMultiple === false) {
    type ViolationRow = { entityId: string; entityType: string }
    const violations = await prisma.$queryRaw<ViolationRow[]>`
      SELECT et."entityId", et."entityType"
      FROM "EntityTag" et
      JOIN "Tag" t ON t.id = et."tagId"
      WHERE t."groupId" = ${groupId}
        AND et.status = 'active'
        AND t."deletedAt" IS NULL
      GROUP BY et."entityId", et."entityType"
      HAVING COUNT(*) > 1
      LIMIT 1
    `
    if (violations.length > 0) {
      return c.json({
        code: 409,
        message: '当前已有实体持有该分组的多个标签，无法修改为不允许多选',
      }, 409)
    }
  }

  try {
    const updated = await prisma.tagGroup.update({
      where: { id: groupId },
      data: {
        ...(body.slug          !== undefined ? { slug:          (body.slug as string).trim() }         : {}),
        ...(body.name          !== undefined ? { name:          (body.name as string).trim() }         : {}),
        ...(body.description   !== undefined ? { description:   body.description as string | null }    : {}),
        ...(body.entityScopes  !== undefined ? { entityScopes:  body.entityScopes as string[] }        : {}),
        ...(body.allowMultiple !== undefined ? { allowMultiple: body.allowMultiple as boolean }        : {}),
        ...(body.sortOrder     !== undefined ? { sortOrder:     body.sortOrder as number }             : {}),
      },
    })
    return c.json({ code: 0, data: updated })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002'))
      return c.json({ code: 409, message: 'slug 或 name 已存在' }, 409)
    logger.error({ err: error }, 'Update tag group error')
    return c.json({ code: 500, message: '更新失败' }, 500)
  }
})

/* ── DELETE /:groupId — 软删除分组 ──────────────────────────── */
tagGroups.delete('/:groupId', requireRole('admin'), async (c) => {
  const groupId = c.req.param('groupId')
  const force   = c.req.query('force') === 'true' || c.req.query('force') === '1'

  const group = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    select: { id: true },
  })
  if (!group) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  if (!force) {
    const usageCount = await prisma.entityTag.count({
      where: { tag: { groupId }, status: 'active' },
    })
    if (usageCount > 0) {
      return c.json({
        code: 409,
        message: `该分组下共有 ${usageCount} 条实体关联，如需强制删除请添加 ?force=true`,
      }, 409)
    }
  }

  // 软删除：仅置 deletedAt。slug/name 保持原值 —— 部分唯一索引
  // (WHERE deletedAt IS NULL) 已保证不会与活跃记录冲突。
  await prisma.tagGroup.update({
    where: { id: groupId },
    data:  { deletedAt: new Date() },
  })
  return c.json({ code: 0, message: '删除成功' })
})

/* ── GET /:groupId/tags — 分组内标签列表（分页）──────────────── */
tagGroups.get('/:groupId/tags', async (c) => {
  const groupId = c.req.param('groupId')
  const { page, pageSize, skip, take } = parsePagination(c.req.query())

  const groupExists = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    select: { id: true },
  })
  if (!groupExists) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  const where = { groupId, deletedAt: null }
  const [items, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      include: { _count: { select: { entityTags: { where: { status: 'active' } } } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      skip,
      take,
    }),
    prisma.tag.count({ where }),
  ])

  return c.json({ code: 0, data: { items, total, page, pageSize } })
})

/* ── PUT /:groupId/entity-rules — 设置分组的实体类型规则 ──── */
tagGroups.put('/:groupId/entity-rules', requireRole('admin'), async (c) => {
  const groupId = c.req.param('groupId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!Array.isArray(body.rules))
    return c.json({ code: 400, message: 'rules 必须为数组' }, 400)

  type RuleInput = { entityType: string; allowMultiple: boolean }
  const rules = body.rules as RuleInput[]
  for (const r of rules) {
    if (!r.entityType || typeof r.entityType !== 'string')
      return c.json({ code: 400, message: 'rules[].entityType 为必填项' }, 400)
    if (typeof r.allowMultiple !== 'boolean')
      return c.json({ code: 400, message: 'rules[].allowMultiple 必须为布尔值' }, 400)
  }

  const groupExists = await prisma.tagGroup.findUnique({
    where: { id: groupId, deletedAt: null },
    select: { id: true },
  })
  if (!groupExists) return c.json({ code: 404, message: '标签分组不存在' }, 404)

  // 全量替换规则
  await prisma.$transaction([
    prisma.tagGroupEntityRule.deleteMany({ where: { groupId } }),
    prisma.tagGroupEntityRule.createMany({
      data: rules.map(r => ({ groupId, entityType: r.entityType, allowMultiple: r.allowMultiple })),
    }),
  ])

  const updated = await prisma.tagGroupEntityRule.findMany({ where: { groupId } })
  return c.json({ code: 0, data: updated })
})

export { tagGroups }
