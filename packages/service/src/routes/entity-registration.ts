import { Hono } from 'hono'
import prisma from '../lib/db.js'
import { isPrismaError } from '../lib/errors.js'
import logger from '../lib/logger.js'

export const registrationRouter = new Hono()

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
