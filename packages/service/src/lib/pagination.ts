export function parsePagination(query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 20)))
  const skip = (page - 1) * pageSize
  return { page, pageSize, skip, take: pageSize }
}

/**
 * 统一布尔型 query 参数解析（#157）。
 * 约定：`true` 或 `1` 视为真，其余（含缺省）为假——所有路由保持一致的 truthiness，
 * 避免出现「某处接受 ?force=1、别处只认 ?force=true」的漂移。
 */
export function parseBool(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}
