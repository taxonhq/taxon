import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '../lib/router.js'
import prisma from '../lib/db.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import { TagAliasSchema, CreateAliasBody, ApiError, OkMessage, okData } from '../lib/schemas.js'

const tagAliases = createRouter()

const TagIdParam   = z.object({ tagId:   z.string().min(1).openapi({ description: '标签 ID' }) })
const AliasIdParam = z.object({ tagId:   z.string().min(1), aliasId: z.string().min(1).openapi({ description: '别名 ID' }) })

// ── GET /tags/:tagId/aliases ──────────────────────────────────────────────────
const listAliasesRoute = createRoute({
  method: 'get', path: '/',
  tags: ['标签'],
  summary: '列出标签别名',
  request: { params: TagIdParam },
  responses: {
    200: { content: { 'application/json': { schema: okData(z.array(TagAliasSchema)) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '标签不存在' },
  },
})

tagAliases.openapi(listAliasesRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const tag = await prisma.tag.findUnique({ where: { id: tagId, deletedAt: null }, select: { id: true } })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)
  const aliases = await prisma.tagAlias.findMany({ where: { tagId }, orderBy: { createdAt: 'asc' } })
  return c.json({ code: 0, data: aliases.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })) }, 200)
})

// ── POST /tags/:tagId/aliases ─────────────────────────────────────────────────
const createAliasRoute = createRoute({
  method: 'post', path: '/',
  tags: ['标签'],
  summary: '添加别名',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: {
    params: TagIdParam,
    body: { content: { 'application/json': { schema: CreateAliasBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(TagAliasSchema) } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '标签不存在' },
    409: { content: { 'application/json': { schema: ApiError } }, description: '别名冲突' },
  },
})

tagAliases.openapi(createAliasRoute, async (c) => {
  const { tagId } = c.req.valid('param')
  const { alias, source } = c.req.valid('json')

  const tag = await prisma.tag.findUnique({ where: { id: tagId, deletedAt: null }, select: { id: true, groupId: true } })
  if (!tag) return c.json({ code: 404, message: '标签不存在' }, 404)

  const conflict = await prisma.tagAlias.findFirst({ where: { alias, tagId: { not: tagId }, tag: { groupId: tag.groupId, deletedAt: null } }, select: { id: true } })
  if (conflict) return c.json({ code: 409, message: '该分组内已有其他标签使用此别名，alias 在分组内必须唯一' }, 409)

  const nameConflict = await prisma.tag.findFirst({ where: { groupId: tag.groupId, deletedAt: null, id: { not: tagId }, OR: [{ name: alias }, { slug: alias }] }, select: { id: true } })
  if (nameConflict) return c.json({ code: 409, message: '该别名与分组内其他标签的名称或 slug 相同，会造成解析歧义' }, 409)

  try {
    const created = await prisma.tagAlias.create({ data: { tagId: tagId as string, alias, source } })
    return c.json({ code: 0, data: { ...created, createdAt: created.createdAt.toISOString() } }, 200)
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2002')) return c.json({ code: 409, message: '该标签已存在此别名' }, 409)
    logger.error({ err: error }, 'Create tag alias error')
    throw error
  }
})

// ── DELETE /tags/:tagId/aliases/:aliasId ──────────────────────────────────────
const deleteAliasRoute = createRoute({
  method: 'delete', path: '/{aliasId}',
  tags: ['标签'],
  summary: '删除别名',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('admin')] as const,
  request: { params: AliasIdParam },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '不存在' },
  },
})

tagAliases.openapi(deleteAliasRoute, async (c) => {
  const { tagId, aliasId } = c.req.valid('param')
  const alias = await prisma.tagAlias.findUnique({ where: { id: aliasId }, select: { id: true, tagId: true } })
  if (!alias || alias.tagId !== tagId) return c.json({ code: 404, message: '别名不存在' }, 404)
  await prisma.tagAlias.delete({ where: { id: aliasId } })
  return c.json({ code: 0, message: '删除成功' }, 200)
})

export { tagAliases }
