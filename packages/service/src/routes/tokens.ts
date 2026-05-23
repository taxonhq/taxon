import { Hono } from 'hono'
import { randomBytes, createHash } from 'crypto'
import prisma from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'
import { isPrismaError } from '../lib/errors.js'
import type { ApiRole } from '../middleware/auth.js'

export const tokensRouter = new Hono()

const VALID_ROLES = new Set<string>(['reader', 'writer', 'reviewer', 'admin'])

// GET /tokens — 列出所有 token（不返回 tokenHash）
tokensRouter.get('/', requireRole('admin'), async (c) => {
  const tokens = await prisma.apiToken.findMany({
    select: {
      id:         true,
      name:       true,
      role:       true,
      scopes:     true,
      createdAt:  true,
      lastUsedAt: true,
      revokedAt:  true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return c.json({ code: 0, data: tokens })
})

// POST /tokens — 创建新 token，返回一次性明文
tokensRouter.post('/', requireRole('admin'), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ code: 400, message: 'name 为必填字符串' }, 400)
  }
  if (!body.role || !VALID_ROLES.has(body.role)) {
    return c.json({ code: 400, message: `role 无效，可选：${[...VALID_ROLES].join(', ')}` }, 400)
  }
  const scopes: string[] = Array.isArray(body.scopes) ? body.scopes : []

  // 生成 32 字节随机 token，hex 编码后前缀加 "ct_" 方便识别
  const rawToken  = 'ct_' + randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const token = await prisma.apiToken.create({
    data: { name: body.name.trim(), tokenHash, role: body.role as ApiRole, scopes },
    select: { id: true, name: true, role: true, scopes: true, createdAt: true },
  })

  return c.json({
    code: 0,
    data: {
      ...token,
      token: rawToken, // 仅此一次返回明文，之后不可再查
    },
  })
})

// DELETE /tokens/:id — 撤销 token（设 revokedAt）
tokensRouter.delete('/:id', requireRole('admin'), async (c) => {
  const { id } = c.req.param()
  try {
    await prisma.apiToken.update({
      where: { id },
      data:  { revokedAt: new Date() },
    })
    return c.json({ code: 0, message: '已撤销' })
  } catch (e) {
    if (isPrismaError(e, 'P2025'))
      return c.json({ code: 404, message: 'Token 不存在' }, 404)
    throw e
  }
})
