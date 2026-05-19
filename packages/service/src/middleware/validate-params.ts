import type { MiddlewareHandler } from 'hono'

// entityType: 小写字母开头，允许小写字母/数字/下划线/连字符，最长 64 字符
// 如 "dish"、"dining_hall"、"product-sku"
const ENTITY_TYPE_RE = /^[a-z][a-z0-9_-]{0,63}$/

// entityId: 允许字母/数字/连字符/下划线/点，最长 128 字符
// 兼容 cuid、uuid、slug 等常见 ID 格式
const ENTITY_ID_RE = /^[a-zA-Z0-9_\-.]{1,128}$/

export const validateEntityParams: MiddlewareHandler = async (c, next) => {
  const { entityType, entityId } = c.req.param() as Record<string, string | undefined>

  if (entityType !== undefined && !ENTITY_TYPE_RE.test(entityType)) {
    return c.json({
      code: 400,
      message: `entityType 格式无效：须以小写字母开头，仅含小写字母/数字/下划线/连字符，最长 64 字符`,
    }, 400)
  }

  if (entityId !== undefined && !ENTITY_ID_RE.test(entityId)) {
    return c.json({
      code: 400,
      message: `entityId 格式无效：仅允许字母/数字/连字符/下划线/点，最长 128 字符`,
    }, 400)
  }

  return next()
}
