import { Registry, Counter, Histogram, Gauge } from 'prom-client'

export const registry = new Registry()
registry.setDefaultLabels({ service: 'taxon' })

// HTTP 请求计数（method × route × status）
export const httpRequestsTotal = new Counter({
  name:       'http_requests_total',
  help:       'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers:  [registry],
})

// HTTP 请求耗时直方图（method × route）
export const httpRequestDuration = new Histogram({
  name:       'http_request_duration_seconds',
  help:       'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers:  [registry],
})

// DB 查询耗时直方图（model × action）
export const dbQueryDuration = new Histogram({
  name:       'db_query_duration_seconds',
  help:       'Database query duration in seconds',
  labelNames: ['model', 'action'] as const,
  buckets:    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers:  [registry],
})

// 待审核标签数量 Gauge（定时刷新）
export const auditPendingCount = new Gauge({
  name:      'audit_pending_count',
  help:      'Number of EntityTag records with status=pending',
  registers: [registry],
})

/**
 * 将请求路径中的动态 ID 段替换为占位符，控制 label 基数。
 * 匹配 cuid（c 开头、20+ 字符）和 UUID 格式。
 */
export function normalizeRoute(path: string): string {
  return path
    .replace(/\/c[a-z][a-z0-9]{18,}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
}
