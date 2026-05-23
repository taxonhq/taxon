import { randomUUID } from 'crypto'
import type { MiddlewareHandler } from 'hono'

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID()
  c.header('x-request-id', id)
  // 存入上下文供日志和错误处理使用
  ;(c as unknown as { set(k: string, v: unknown): void }).set('requestId', id)
  await next()
}

/** 从 Hono 上下文读取 requestId，不存在时返回 'unknown'。 */
export function getRequestId(c: { get: (key: string) => unknown }): string {
  return (c.get('requestId') as string | undefined) ?? 'unknown'
}
