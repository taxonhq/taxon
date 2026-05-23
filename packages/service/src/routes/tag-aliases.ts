import { Hono } from 'hono'
import prisma from '../lib/db.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'

const tagAliases = new Hono()

const MAX_ALIAS_LENGTH  = 100
const VALID_SOURCES     = ['manual', 'ai', 'import'] as const
const ALIAS_FORMAT      = /^.{1,100}$/   // 允许任意字符，只限长度

/* ── GET /tags/:tagId/aliases — 列出别名 ───────────────────────── */
tagAliases.get('/', async (c) => {
  const tagId = c.req.param('tagId')

  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  const aliases = await prisma.tagAlias.findMany({
    where: { tagId },
    orderBy: { createdAt: 'asc' },
  })
  return c.json({ code: 0, data: aliases })
})

/* ── POST /tags/:tagId/aliases — 添加别名 ─────────────────────── */
tagAliases.post('/', requireRole('admin'), async (c) => {
  const tagId = c.req.param('tagId')

  let body: Record<string, unknown>
  try { body = await c.req.json() } catch {
    return c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400)
  }

  if (!body.alias || typeof body.alias !== 'string' || !(body.alias as string).trim())
    return c.json({ code: 400, message: 'alias 为必填项' }, 400)

  const alias = (body.alias as string).trim()
  if (alias.length > MAX_ALIAS_LENGTH)
    return c.json({ code: 400, message: `alias 不能超过 ${MAX_ALIAS_LENGTH} 个字符` }, 400)

  const rawSource = body.source as string | undefined
  if (rawSource && !VALID_SOURCES.includes(rawSource as typeof VALID_SOURCES[number]))
    return c.json({ code: 400, message: `source 只能为 ${VALID_SOURCES.join(' | ')}` }, 400)
  const source = rawSource ?? 'manual'

  // 获取当前 tag 及其所属 groupId
  const tag = await prisma.tag.findUnique({
    where: { id: tagId, deletedAt: null },
    select: { id: true, groupId: true },
  })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  // 同 group 唯一性校验：同一分组内 alias 不能指向两个不同 tag
  const conflict = await prisma.tagAlias.findFirst({
    where: {
      alias,
      tagId:  { not: tagId },
      tag:    { groupId: tag.groupId, deletedAt: null },
    },
    select: { id: true, tagId: true },
  })
  if (conflict)
    return c.json({ code: 409, message: '该分组内已有其他标签使用此别名，alias 在分组内必须唯一' }, 409)

  // 同名/主名冲突：alias 与同 group 内某 tag 的 name 或 slug 重复会造成 resolve 歧义
  const nameConflict = await prisma.tag.findFirst({
    where: {
      groupId:   tag.groupId,
      deletedAt: null,
      id:        { not: tagId },
      OR: [{ name: alias }, { slug: alias }],
    },
    select: { id: true },
  })
  if (nameConflict)
    return c.json({ code: 409, message: '该别名与分组内其他标签的名称或 slug 相同，会造成解析歧义' }, 409)

  try {
    const created = await prisma.tagAlias.create({
      data: { tagId: tagId as string, alias, source },
    })
    return c.json({ code: 0, data: created })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002'))
      return c.json({ code: 409, message: '该标签已存在此别名' }, 409)
    logger.error({ err: error }, 'Create tag alias error')
    return c.json({ code: 500, message: '创建失败' }, 500)
  }
})

/* ── DELETE /tags/:tagId/aliases/:aliasId — 删除别名 ─────────── */
tagAliases.delete('/:aliasId', requireRole('admin'), async (c) => {
  const tagId   = c.req.param('tagId')
  const aliasId = c.req.param('aliasId')

  const alias = await prisma.tagAlias.findUnique({
    where: { id: aliasId },
    select: { id: true, tagId: true },
  })
  if (!alias || alias.tagId !== tagId)
    return c.json({ code: 404, message: '别名不存在' }, 404)

  await prisma.tagAlias.delete({ where: { id: aliasId } })
  return c.json({ code: 0, message: '删除成功' })
})

export { tagAliases }
