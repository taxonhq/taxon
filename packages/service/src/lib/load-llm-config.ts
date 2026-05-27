/**
 * LLM 配置加载工具 — 独立模块，便于测试时 mock。
 *
 * 与路由文件（llm-config.ts）分离，使 entity-suggest 等业务路由
 * 无需导入整个路由模块（避免 OpenAPIHono 实例副作用污染测试 mock）。
 */

import prisma from './db.js'
import { LlmConfigStored } from './schemas.js'
import { decryptSecret } from './crypto.js'

const CONFIG_KEY = 'llm-config'

/**
 * 从 SystemConfig 读取并解密 LLM 配置。
 * 若未配置、未启用或解密失败，返回 null。
 */
export async function loadActiveLlmConfig(): Promise<{
  provider: 'anthropic' | 'openai'
  model:    string
  apiKey:   string
  baseUrl?: string
} | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
  if (!row) return null
  const parsed = LlmConfigStored.safeParse(row.value)
  if (!parsed.success) return null
  const stored = parsed.data
  if (!stored.enabled) return null
  if (!stored.apiKey)  return null
  try {
    const plain = decryptSecret(stored.apiKey)
    if (!plain) return null
    return {
      provider: stored.provider,
      model:    stored.model,
      apiKey:   plain,
      baseUrl:  stored.baseUrl,
    }
  } catch {
    return null
  }
}
