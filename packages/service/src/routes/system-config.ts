/**
 * 系统配置路由
 *   GET /settings/system  — 读取系统配置（locale 等）
 *   PUT /settings/system  — 更新系统配置（仅 admin）
 *
 * 存储：SystemConfig.key='system-config'，value 为 SystemConfigStored。
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import prisma from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'
import { ApiError, okData, OkMessage } from '../lib/schemas.js'

export const systemConfigRouter = new OpenAPIHono()

const CONFIG_KEY = 'system-config'

const LOCALES = ['zh-CN', 'en-US'] as const
type Locale = typeof LOCALES[number]

const SystemConfigSchema = z.object({
  locale: z.enum(LOCALES).default('zh-CN').openapi({ description: '界面语言 zh-CN | en-US' }),
}).openapi('SystemConfig')

const SystemConfigUpdateBody = z.object({
  locale: z.enum(LOCALES).optional(),
}).openapi('SystemConfigUpdateBody')

const DEFAULT_CONFIG = { locale: 'zh-CN' as Locale }

// ── GET /settings/system ──────────────────────────────────────────
const getRoute = createRoute({
  method: 'get', path: '/system',
  tags: ['系统设置'],
  summary: '获取系统配置',
  security: [{ BearerAuth: [] }],
  responses: {
    200: { content: { 'application/json': { schema: okData(SystemConfigSchema) } }, description: '成功' },
  },
})

systemConfigRouter.use('/system', requireRole('reader'))
systemConfigRouter.openapi(getRoute, async (c) => {
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
  if (!row) return c.json({ code: 0, data: DEFAULT_CONFIG }, 200)

  const parsed = SystemConfigSchema.safeParse(row.value)
  const data   = parsed.success ? parsed.data : DEFAULT_CONFIG
  return c.json({ code: 0, data }, 200)
})

// ── PUT /settings/system ──────────────────────────────────────────
const putRoute = createRoute({
  method: 'put', path: '/system',
  tags: ['系统设置'],
  summary: '更新系统配置（仅 admin）',
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: SystemConfigUpdateBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: OkMessage } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
})

systemConfigRouter.use('/system', requireRole('admin'))
systemConfigRouter.openapi(putRoute, async (c) => {
  const body = c.req.valid('json')

  const existing = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
  const current  = existing?.value && typeof existing.value === 'object'
    ? (existing.value as Record<string, unknown>)
    : { ...DEFAULT_CONFIG }

  const updated = { ...current, ...(body.locale ? { locale: body.locale } : {}) }

  await prisma.systemConfig.upsert({
    where:  { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: updated },
    update: { value: updated },
  })

  return c.json({ code: 0, message: 'ok' }, 200)
})
