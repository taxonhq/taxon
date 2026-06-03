/**
 * Shared OpenAPIHono factory.
 *
 * 所有资源子路由都应通过 `createRouter()` 创建，而不是直接 `new OpenAPIHono()`。
 * 原因：`@hono/zod-openapi` 的 `defaultHook`（schema 校验失败时的回调）是**实例级**的，
 * `app.route(子路由)` 挂载时不会把父实例的 hook 传给子实例。若子路由不带 hook，
 * `createRoute` 的请求校验失败会泄漏库默认的 `{ success, error }` 形状，破坏项目统一的
 * `{ code, message }` 错误信封（见 #140）。
 *
 * 这里统一返回 `{ code: 400, message }`：400 表示「请求结构/参数不合法」，与 lib/validate.ts
 * 的 zParse 对齐；业务/语义错误（如 allowMultiple 冲突）仍由各 handler 显式返回 422。
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { formatZodError } from './validate.js'

export function createRouter() {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ code: 400, message: formatZodError(result.error) }, 400)
      }
    },
  })
}
