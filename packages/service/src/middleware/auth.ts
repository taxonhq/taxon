import { timingSafeEqual } from 'crypto'
import type { MiddlewareHandler } from 'hono'

// Bearer token auth
// - Production (NODE_ENV=production): API_TOKEN 必须设置，否则启动时拒绝
// - Development: API_TOKEN 未设置时跳过认证，但每次请求打印警告
export const bearerAuth: MiddlewareHandler = async (c, next) => {
  const token = process.env.API_TOKEN
  if (!token) return next() // dev-only fallback，生产环境在启动时已拦截

  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '需要 Bearer Token 认证' }, 401)
  }

  const provided = Buffer.from(header.slice(7))
  const expected = Buffer.from(token)
  const valid =
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)

  if (!valid) {
    return c.json({ code: 403, message: '认证失败：Token 无效' }, 403)
  }
  return next()
}
