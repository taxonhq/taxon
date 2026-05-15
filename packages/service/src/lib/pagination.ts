export function parsePagination(query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize) || 20)))
  const skip = (page - 1) * pageSize
  return { page, pageSize, skip, take: pageSize }
}
