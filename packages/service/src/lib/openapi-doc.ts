/**
 * OpenAPI 文档生成 —— 版本化（#154）。
 *
 * API 业务路由同时挂在 `/v1`（canonical）与 `/`（向后兼容别名）两处（见 app.ts）。
 * 为了让对外 spec 干净、无歧义，这里：
 *   1. 只保留 `/v1` 前缀的路径（丢弃 `/` 别名产生的重复项）；
 *   2. 把 `/v1` 从 path key 里剥掉，改由 `servers[].url` 承载版本前缀
 *      —— 这是 OpenAPI 表达「版本化 API」的标准方式，生成的 SDK / Scalar
 *      "try it" 会自动拼上 `/v1`。
 *
 * app.ts 的 `/openapi.json` 路由与 scripts/export-spec.ts 都走这里，保证
 * 运行时 spec 与提交到仓库的 openapi.json 完全一致（check-openapi-drift 依赖）。
 */
import type { OpenAPIHono } from '@hono/zod-openapi'

export const API_VERSION_PREFIX = '/v1'

export const OPENAPI_INFO = {
  openapi: '3.0.0',
  info: {
    title: 'Taxon Tag Service',
    version: '1.0.0',
    description: [
      'Standalone tagging microservice — tag groups, entity tagging, audit workflow.',
      '',
      '## 统一响应信封',
      '所有业务接口返回统一信封：',
      '- 成功：`{ "code": 0, "data": ... }`（或仅 `{ "code": 0, "message": "..." }`）',
      '- 失败：`{ "code": <httpStatus>, "message": "..." }`',
      '',
      '## 错误码约定',
      '`code` 与 HTTP 状态码一致：`400` 参数/结构不合法 · `401` 未认证 · '
        + '`403` 权限不足 · `404` 资源不存在 · `409` 冲突（重名/在用）· '
        + '`422` 业务校验失败（如分组不允许多选）· `429` 触发限流 · `500` 服务内部错误。',
      '',
      '## 版本',
      '当前版本 `v1`，所有业务路径以 `/v1` 为前缀（见 servers）。基础设施端点'
        + '（`/health`、`/metrics`、`/openapi.json`、`/docs`）不版本化。',
    ].join('\n'),
  },
  security: [{ BearerAuth: [] }],
} as const

/**
 * 生成对外 OpenAPI 文档：从 app 收集全部 createRoute 定义，过滤为 `/v1` 视图，
 * 并把版本前缀移到 servers。
 */
export function buildOpenApiSpec(app: OpenAPIHono): Record<string, unknown> {
  // getOpenAPIDocument 收集 app 上所有（含子路由）createRoute 定义。
  const doc = (app as unknown as {
    getOpenAPIDocument: (cfg: typeof OPENAPI_INFO) => Record<string, unknown>
  }).getOpenAPIDocument(OPENAPI_INFO)

  const rawPaths = (doc.paths ?? {}) as Record<string, unknown>
  const versioned: Record<string, unknown> = {}
  for (const [path, item] of Object.entries(rawPaths)) {
    if (!path.startsWith(API_VERSION_PREFIX)) continue // 丢弃 `/` 别名重复项
    const stripped = path.slice(API_VERSION_PREFIX.length) || '/'
    versioned[stripped] = item
  }

  doc.paths = versioned
  doc.servers = [{ url: API_VERSION_PREFIX, description: 'API v1 (current)' }]
  return doc
}
