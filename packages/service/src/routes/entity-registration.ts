import { Hono } from 'hono'
import prisma from '../lib/db.js'
import { isPrismaError } from '../lib/errors.js'
import { parsePagination } from '../lib/pagination.js'
import logger from '../lib/logger.js'

export const registrationRouter = new Hono()

// GET /:entityType — 列出某类型下所有已注册实体（分页 + 可选 search）
registrationRouter.get('/:entityType', async (c) => {
  const { entityType } = c.req.param()
  const search = c.req.query('search')?.trim() || undefined
  const { page, pageSize } = parsePagination(c.req.query())

  const where = {
    entityType,
    ...(search ? { entityId: { contains: search } } : {}),
  }

  const [items, total] = await Promise.all([
    prisma.registeredEntity.findMany({
      where,
      select: { entityType: true, entityId: true, registeredAt: true },
      orderBy: { registeredAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.registeredEntity.count({ where }),
  ])

  return c.json({ code: 0, data: { items, total, page, pageSize } })
})

registrationRouter.post('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  try {
    await prisma.registeredEntity.upsert({
      where:  { entityType_entityId: { entityType, entityId } },
      create: { entityType, entityId },
      update: {},
    })
    return c.json({ code: 0, message: '注册成功' })
  } catch (error: unknown) {
    logger.error({ err: error, entityType, entityId }, 'Register entity error')
    return c.json({ code: 500, message: '注册失败' }, 500)
  }
})

registrationRouter.delete('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  try {
    await prisma.registeredEntity.delete({
      where: { entityType_entityId: { entityType, entityId } },
    })
    return c.json({ code: 0, message: '注销成功' })
  } catch (error: unknown) {
    if (isPrismaError(error, 'P2025'))
      return c.json({ code: 404, message: '实体未注册' }, 404)
    logger.error({ err: error, entityType, entityId }, 'Unregister entity error')
    return c.json({ code: 500, message: '注销失败' }, 500)
  }
})

registrationRouter.get('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  const entity = await prisma.registeredEntity.findUnique({
    where:  { entityType_entityId: { entityType, entityId } },
    select: { entityType: true, entityId: true, registeredAt: true },
  })
  if (!entity) return c.json({ code: 404, message: '实体未注册' }, 404)
  return c.json({ code: 0, data: entity })
})
