import { Hono } from 'hono'
import prisma from '../lib/db.js'
import { parsePagination } from '../lib/pagination.js'
import { generateSlug } from '../lib/slug.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'

const tags = new Hono()

const MAX_NAME_LENGTH = 50
const MAX_SLUG_LENGTH = 100
const MAX_DESC_LENGTH = 200
const SLUG_FORMAT = /^[a-z0-9][a-z0-9_-]*$/

/* ── GET / — 列出标签（支持按分组、名称过滤、分页）──────────── */
tags.get('/', async (c) => {
  const { page, pageSize, skip, take } = parsePagination(c.req.query())
  const groupId = c.req.query('groupId')
  const q       = c.req.query('q')

  const where = {
    deletedAt: null,
    ...(groupId ? { groupId } : {}),
    ...(q       ? { name: { contains: q } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      include: {
        group: { select: { id: true, slug: true, name: true } },
        _count: { select: { entityTags: { where: { status: 'active' } } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
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
      group: true,
      _count: { select: { entityTags: { where: { status: 'active' } } } },
    },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
  return c.json({ code: 0, data: tag })
})

/* ── POST / — 创建标签 ──────────────────────────────────────── */
tags.post('/', async (c) => {
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
    prisma.tag.findFirst({
      where: { groupId: body.groupId as string, name, deletedAt: null },
      select: { id: true },
    }),
    prisma.tag.findFirst({
      where: { groupId: body.groupId as string, slug, deletedAt: null },
      select: { id: true },
    }),
  ])
  if (conflictName) return c.json({ code: 409, message: '该分组内 name 已存在' }, 409)
  if (conflictSlug) {
    if (body.slug != null) return c.json({ code: 409, message: '该分组内 slug 已存在' }, 409)
    // 自动生成的 slug 冲突时追加随机后缀
    slug = `${slug.slice(0, MAX_SLUG_LENGTH - 9)}-${Date.now().toString(36)}`
  }

  try {
    const tag = await prisma.tag.create({
      data: {
        groupId: body.groupId as string,
        slug,
        name,
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

/* ── PATCH /:tagId — 更新标签（支持 name / slug / description / sortOrder）*/
tags.patch('/:tagId', async (c) => {
  const tagId = c.req.param('tagId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  const hasName        = Object.prototype.hasOwnProperty.call(body, 'name')
  const hasSlug        = Object.prototype.hasOwnProperty.call(body, 'slug')
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description')
  const hasSortOrder   = Object.prototype.hasOwnProperty.call(body, 'sortOrder')
  if (!hasName && !hasSlug && !hasDescription && !hasSortOrder)
    return c.json({ code: 400, message: '至少需要传入 name、slug、description、sortOrder 之一' }, 400)

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
    select: { id: true, groupId: true },
  })
  if (!existing) return c.json({ code: 404, message: '标签不存在' }, 404)

  // 检查 name/slug 冲突（同分组内，排除自身，排除软删除记录）
  const conflictChecks = []
  if (hasName) {
    conflictChecks.push(
      prisma.tag.findFirst({
        where: { groupId: existing.groupId, name: (body.name as string).trim(), id: { not: tagId }, deletedAt: null },
        select: { id: true },
      })
    )
  } else {
    conflictChecks.push(Promise.resolve(null))
  }
  if (hasSlug) {
    conflictChecks.push(
      prisma.tag.findFirst({
        where: { groupId: existing.groupId, slug: (body.slug as string).trim(), id: { not: tagId }, deletedAt: null },
        select: { id: true },
      })
    )
  } else {
    conflictChecks.push(Promise.resolve(null))
  }

  const [nameConflict, slugConflict] = await Promise.all(conflictChecks)
  if (nameConflict) return c.json({ code: 409, message: '该分组内 name 已存在' }, 409)
  if (slugConflict) return c.json({ code: 409, message: '该分组内 slug 已存在' }, 409)

  try {
    const tag = await prisma.tag.update({
      where: { id: tagId },
      data: {
        ...(hasName        ? { name: (body.name as string).trim() }         : {}),
        ...(hasSlug        ? { slug: (body.slug as string).trim() }         : {}),
        ...(hasDescription ? { description: body.description as string | null } : {}),
        ...(hasSortOrder   ? { sortOrder: body.sortOrder as number }         : {}),
      },
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
tags.delete('/:tagId', async (c) => {
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

  // 软删除：仅置 deletedAt。slug/name 保持原值 —— 部分唯一索引
  // (WHERE deletedAt IS NULL) 已保证不会与活跃记录冲突。
  await prisma.tag.update({
    where: { id: tagId },
    data:  { deletedAt: new Date() },
  })
  return c.json({ code: 0, message: '删除成功' })
})

export { tags }
