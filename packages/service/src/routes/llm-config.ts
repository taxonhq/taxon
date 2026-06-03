/**
 * LLM 配置路由
 *   GET /settings/llm  — 当前配置（apiKey 脱敏）
 *   PUT /settings/llm  — 更新配置（仅 admin）
 *
 * 存储：SystemConfig.key='llm-config'，value 为 LlmConfigStored（apiKey 加密）。
 */
import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '../lib/router.js'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import {
  LlmConfigPublic, LlmConfigStored, LlmConfigUpdateBody,
  ApiError, okData,
} from '../lib/schemas.js'
import { encryptSecret, decryptSecret, maskApiKey, EncryptionError } from '../lib/crypto.js'

export const llmConfigRouter = createRouter()

const CONFIG_KEY = 'llm-config'

// ── GET /settings/llm ─────────────────────────────────────────────────────────
const getRoute = createRoute({
  method: 'get', path: '/llm',
  tags: ['系统设置'],
  summary: '获取 LLM 配置',
  description: 'API key 仅以 mask 形式返回（如 sk-x…abcd），明文不外泄。',
  security: [{ BearerAuth: [] }],
  responses: {
    200: { content: { 'application/json': { schema: okData(LlmConfigPublic) } }, description: '成功' },
  },
})

llmConfigRouter.use('/llm', requireRole('admin'))
llmConfigRouter.openapi(getRoute, async (c) => {
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
  if (!row) {
    return c.json({ code: 0, data: { hasApiKey: false, enabled: false } }, 200)
  }
  const parsed = LlmConfigStored.safeParse(row.value)
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, 'llm-config row corrupted, returning empty')
    return c.json({ code: 0, data: { hasApiKey: false, enabled: false } }, 200)
  }
  const stored = parsed.data
  let apiKeyMask = ''
  let hasApiKey  = false
  if (stored.apiKey) {
    try {
      const plain = decryptSecret(stored.apiKey)
      apiKeyMask = maskApiKey(plain)
      hasApiKey  = plain.length > 0
    } catch (e) {
      logger.warn({ err: e }, 'llm-config api key decrypt failed')
    }
  }
  return c.json({
    code: 0,
    data: {
      provider:  stored.provider,
      model:     stored.model,
      baseUrl:   stored.baseUrl,
      enabled:   stored.enabled,
      hasApiKey,
      apiKeyMask,
    },
  }, 200)
})

// ── PUT /settings/llm ─────────────────────────────────────────────────────────
const putRoute = createRoute({
  method: 'put', path: '/llm',
  tags: ['系统设置'],
  summary: '更新 LLM 配置',
  description: 'apiKey 字段：缺省=保持原值；空字符串=清空；其他=替换并加密存储。',
  security: [{ BearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: LlmConfigUpdateBody } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(LlmConfigPublic) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '加密失败 / 主密钥未配置' },
  },
})

llmConfigRouter.openapi(putRoute, async (c) => {
  const body = c.req.valid('json')

  // 取出当前 stored apiKey（若有），用于"缺省=保持原值"
  let prevApiKeyEnc = ''
  const existing = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
  if (existing) {
    const parsed = LlmConfigStored.safeParse(existing.value)
    if (parsed.success) prevApiKeyEnc = parsed.data.apiKey
  }

  let nextApiKeyEnc: string
  try {
    if (body.apiKey === undefined) {
      nextApiKeyEnc = prevApiKeyEnc   // keep existing
    } else if (body.apiKey === '') {
      nextApiKeyEnc = ''              // clear
    } else {
      nextApiKeyEnc = encryptSecret(body.apiKey)
    }
  } catch (e) {
    if (e instanceof EncryptionError) {
      return c.json({ code: 400, message: e.message }, 400)
    }
    throw e
  }

  const stored: LlmConfigStored = {
    provider: body.provider,
    model:    body.model,
    apiKey:   nextApiKeyEnc,
    baseUrl:  body.baseUrl,
    enabled:  body.enabled,
  }

  await prisma.systemConfig.upsert({
    where:  { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: stored },
    update: { value: stored },
  })

  let apiKeyMask = ''
  let hasApiKey  = false
  if (nextApiKeyEnc) {
    try {
      const plain = decryptSecret(nextApiKeyEnc)
      apiKeyMask = maskApiKey(plain)
      hasApiKey  = plain.length > 0
    } catch { /* ignore */ }
  }
  return c.json({
    code: 0,
    data: {
      provider:  stored.provider,
      model:     stored.model,
      baseUrl:   stored.baseUrl,
      enabled:   stored.enabled,
      hasApiKey,
      apiKeyMask,
    },
  }, 200)
})

/** 内部读取：返回明文 LlmConfig 或 null。给 nl-to-dsl / entity-suggest 路由用。
 *  实现已迁移至 lib/load-llm-config.ts，此处仅 re-export 保持向后兼容。 */
export { loadActiveLlmConfig } from '../lib/load-llm-config.js'
