import { createHash, timingSafeEqual } from 'crypto'
import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'

export type ApiRole = 'reader' | 'writer' | 'reviewer' | 'admin'

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
    // 异步更新 lastUsedAt，不阻塞请求
    prisma.apiToken.update({
      where: { id: dbToken.id },
      data:  { lastUsedAt: new Date() },
    }).catch(() => {})

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

// 开发模式兼容：API_TOKEN 未设置且无 DB token 时跳过认证（保持原有行为）。
// Bypass 时以 admin 身份注入上下文，确保 requireRole 中间件正常放行。
export const bearerAuth: MiddlewareHandler = async (c, next) => {
  if (!process.env.API_TOKEN && !(await hasAnyDbToken())) {
    c.set('tokenRole', 'admin' as ApiRole)
    c.set('tokenName',  'dev-bypass')
    return next()
  }
  return tokenAuth(c, next)
}

async function hasAnyDbToken(): Promise<boolean> {
  try {
    const count = await prisma.apiToken.count()
    return count > 0
  } catch {
    return false
  }
}
