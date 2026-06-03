import { createHash, timingSafeEqual } from 'crypto'
import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'

export type ApiRole = 'reader' | 'writer' | 'reviewer' | 'admin'

// ── Token 缓存 ───────────────────────────────────────────────────────
// 模块级标志，进程启动后一次性确认是否存在 DB token。
// token 创建/撤销时通过 invalidateTokenCache() 使缓存失效（O(1) lookup）。
let _cachedHasDbToken: boolean | null = null

/** token 创建/撤销后调用，清除缓存以便下次请求重新检测 */
export function invalidateTokenCache(): void {
  _cachedHasDbToken = null
}

// lastUsedAt 写节流（#138）：每个 token 至多每 N 分钟写一次，避免每请求一写造成写放大。
// 精度到分钟级足够展示「最近使用」，map 大小受 token 数量限制。
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000
const _lastUsedWrites = new Map<string, number>()

function touchLastUsed(tokenId: string): void {
  const now = Date.now()
  if (now - (_lastUsedWrites.get(tokenId) ?? 0) < LAST_USED_WRITE_INTERVAL_MS) return
  _lastUsedWrites.set(tokenId, now)
  // 异步 fire-and-forget，不阻塞请求
  prisma.apiToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } }).catch(() => {})
}

const ROLE_LEVEL: Record<ApiRole, number> = {
  reader:   0,
  writer:   1,
  reviewer: 2,
  admin:    3,
}

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// 全局认证中间件：识别 Bearer Token，将角色写入 Hono 上下文。
// 优先查 ApiToken 表（DB）；找不到时 fallback 到 env API_TOKEN（admin 角色）。
// 两者都不匹配 → 401/403。
export const tokenAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '需要 Bearer Token 认证' }, 401)
  }

  const raw  = header.slice(7)
  const hash = sha256(raw)

  // ── DB Token ───────────────────────────────────────────────
  const dbToken = await prisma.apiToken.findUnique({ where: { tokenHash: hash } })
  if (dbToken) {
    if (dbToken.revokedAt) {
      return c.json({ code: 403, message: '认证失败：Token 已撤销' }, 403)
    }
    // 更新 lastUsedAt（按 token 节流，避免每请求一写 → 写放大，#138）
    touchLastUsed(dbToken.id)

    c.set('tokenRole', dbToken.role as ApiRole)
    c.set('tokenName', dbToken.name)
    c.set('tokenId',   dbToken.id)
    return next()
  }

  // ── env API_TOKEN fallback（admin，deprecation 警告） ───────
  const envToken = process.env.API_TOKEN
  if (envToken) {
    const envHash = sha256(envToken)
    const a = Buffer.from(hash,    'hex')
    const b = Buffer.from(envHash, 'hex')
    if (a.length === b.length && timingSafeEqual(a, b)) {
      logger.warn('API_TOKEN env var 已废弃，请在 /tokens 创建 ApiToken 记录')
      c.set('tokenRole', 'admin' as ApiRole)
      c.set('tokenName', 'env:API_TOKEN')
      return next()
    }
  }

  return c.json({ code: 403, message: '认证失败：Token 无效' }, 403)
}

// 路由级权限检查工厂。在 tokenAuth 之后使用。
// 示例：router.post('/', requireRole('admin'), handler)
export function requireRole(min: ApiRole) {
  return createMiddleware(async (c, next) => {
    const role = c.get('tokenRole') as ApiRole | undefined
    if (!role || ROLE_LEVEL[role] < ROLE_LEVEL[min]) {
      return c.json({ code: 403, message: `需要 ${min} 或更高权限` }, 403)
    }
    return next()
  })
}

// 从 Hono 上下文读取 tokenId（由 tokenAuth 写入，dev-bypass 时为 null）。
// 使用宽松类型参数避免路由文件中的 Variables 泛型声明，同时保持类型安全。
export function getTokenId(c: { get: (key: string) => unknown }): string | null {
  return (c.get('tokenId') as string | undefined) ?? null
}

// 开发模式兼容：仅在 NODE_ENV !== 'production' 且无任何 token 配置时绕过认证。
// 缓存 DB 查询结果，避免每请求一次 COUNT(*)。
export const bearerAuth: MiddlewareHandler = async (c, next) => {
  const isProd = process.env.NODE_ENV === 'production'

  // 生产环境永不 bypass
  if (!isProd && !process.env.API_TOKEN && !(await hasAnyDbToken())) {
    logger.warn(
      { path: c.req.path, method: c.req.method },
      'dev-bypass: 认证已绕过（开发模式，无 token 配置）— 请勿用于生产'
    )
    c.set('tokenRole', 'admin' as ApiRole)
    c.set('tokenName',  'dev-bypass')
    return next()
  }
  return tokenAuth(c, next)
}

async function hasAnyDbToken(): Promise<boolean> {
  if (_cachedHasDbToken !== null) return _cachedHasDbToken
  try {
    const count = await prisma.apiToken.count()
    _cachedHasDbToken = count > 0
    return _cachedHasDbToken
  } catch {
    return false
  }
}
