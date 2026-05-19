import type { MiddlewareHandler } from 'hono'

// Bearer token auth — skip when API_TOKEN is not set (local dev)
export const bearerAuth: MiddlewareHandler = async (c, next) => {
  const token = process.env.API_TOKEN
  if (!token) return next()

  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '需要 Bearer Token 认证' }, 401)
  }
  if (header.slice(7) !== token) {
    return c.json({ code: 403, message: '认证失败：Token 无效' }, 403)
  }
  return next()
}
