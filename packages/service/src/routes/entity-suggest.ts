/**
 * POST /entities/:entityType/:entityId/suggest
 *
 * 使用 LLM 为已注册实体生成标签建议（Phase 1 of #33）。
 *
 * 流程：
 *   1. 加载该 entityType 可用的标签（按 groups 过滤）
 *   2. 读取 /settings/llm 中的 LLM 配置（apiKey 解密）
 *   3. 构建系统 prompt + 用户 prompt，调用 LLM 结构化输出
 *   4. 将 LLM 返回的 tagId 与实际标签对照，过滤无效项
 *   5. 按 minConfidence 过滤，topK 截断
 *   6. 可选：apply=true 时将建议自动写入为 pending EntityTag
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import { buildProvider, LlmError } from '../lib/llm/index.js'
import { loadActiveLlmConfig } from '../lib/load-llm-config.js'
import {
  SuggestBody, SuggestData, SuggestionItem,
  ApiError, okData,
} from '../lib/schemas.js'

export const suggestRouter = new OpenAPIHono()

const SuggestParams = z.object({
  entityType: z.string().min(1),
  entityId:   z.string().min(1),
})

const suggestRoute = createRoute({
  method:  'post',
  path:    '/{entityType}/{entityId}/suggest',
  tags:    ['AI 标签建议'],
  summary: 'AI 标签建议生成',
  description:
    '根据实体上下文和可用标签集合，调用 LLM 返回置信度排序的打标建议。' +
    '需要先在 /settings/llm 配置好 LLM provider，否则返回 503。',
  security: [{ BearerAuth: [] }],
  middleware: [requireRole('writer')] as const,
  request: {
    params: SuggestParams,
    body: {
      content: { 'application/json': { schema: SuggestBody } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: okData(SuggestData) } },
      description: '建议生成成功',
    },
    404: {
      content: { 'application/json': { schema: ApiError } },
      description: '实体未注册 / 指定分组不存在',
    },
    503: {
      content: { 'application/json': { schema: ApiError } },
      description: 'LLM 未配置或调用失败',
    },
  },
})

// ── LLM 输出结构定义（JSON Schema，传给 LLM 做结构化输出约束） ─────────────
const LLM_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tagId:      { type: 'string',  description: '标签 ID，必须来自可用标签列表中的 id 字段' },
          confidence: { type: 'number',  description: '置信度 0~1，越高越确定' },
          reasoning:  { type: 'string',  description: '简短推荐理由（中文，≤80字）' },
        },
        required: ['tagId', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const

// LLM 原始输出的 Zod schema（用于二次校验）
const LlmRawOutput = z.object({
  suggestions: z.array(z.object({
    tagId:      z.string(),
    confidence: z.number().min(0).max(1),
    reasoning:  z.string(),
  })),
})

suggestRouter.openapi(suggestRoute, async (c) => {
  const { entityType, entityId } = c.req.valid('param')

  // body 是 optional，openapi 中间件不做强制解析
  let body: z.infer<typeof SuggestBody> = {}
  try { body = await c.req.json() } catch { /* 空 body 合法 */ }

  const {
    groups:        groupFilter,
    context:       contextMap = {},
    model:         modelOverride,
    topK          = 5,
    minConfidence = 0,
    apply         = false,
  } = body

  // ── 1. Fail-fast：LLM 配置 ──────────────────────────────────────────────
  const llmCfg = await loadActiveLlmConfig()
  if (!llmCfg) {
    return c.json({
      code: 503,
      message: 'LLM 未配置或未启用，请先在 /settings/llm 配置并启用 AI 服务',
    }, 503)
  }

  // ── 2. 检查实体是否已注册，顺带读取 metadata ────────────────────────────
  const entity = await prisma.registeredEntity.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    select: { entityType: true, metadata: true },
  })
  if (!entity) return c.json({ code: 404, message: '实体未注册，请先调用 POST /entities/:type/:id 注册' }, 404)

  // body.context 覆盖/补充 entity.metadata：
  //   - 未传 context → 完全使用 metadata
  //   - 传了 context → merge（context 优先），满足"临时覆盖"场景
  const storedMeta = (entity.metadata ?? {}) as Record<string, string>
  const effectiveContext: Record<string, string> = { ...storedMeta, ...contextMap }

  // 检查推荐字段是否存在，缺失时记录警告（不阻断请求）
  const recommendedFields = ['name', 'description', 'category'] as const
  const missingFields = recommendedFields.filter(f => !effectiveContext[f])
  if (missingFields.length > 0) {
    logger.warn(
      { entityType, entityId, missingFields },
      'AI suggest: 实体缺少推荐 metadata 字段，建议质量可能下降。推荐字段：name、description、category'
    )
  }

  // ── 3. 加载可用标签 ──────────────────────────────────────────────────────
  // 先确定要查哪些分组的 ID，再查 tag。两步查询比嵌套 where 类型更安全。
  let groupIds: string[]
  if (groupFilter && groupFilter.length > 0) {
    // groupFilter 项目可以是 group slug 或 group id
    const foundGroups = await prisma.tagGroup.findMany({
      where: {
        deletedAt: null,
        OR: [
          { id:   { in: groupFilter } },
          { slug: { in: groupFilter } },
        ],
      },
      select: { id: true, slug: true },
    })
    const foundSlugsAndIds = new Set([...foundGroups.map(g => g.id), ...foundGroups.map(g => g.slug)])
    const missing = groupFilter.filter(f => !foundSlugsAndIds.has(f))
    if (missing.length > 0) {
      return c.json({ code: 404, message: `分组不存在：${missing.join(', ')}` }, 404)
    }
    groupIds = foundGroups.map(g => g.id)
  } else {
    // 未指定分组：取对该 entityType 适用的分组（entityScopes 为空=通用）
    const applicableGroups = await prisma.tagGroup.findMany({
      where: {
        deletedAt: null,
        OR: [
          { entityScopes: { isEmpty: true } },
          { entityScopes: { has: entityType } },
        ],
      },
      select: { id: true },
    })
    groupIds = applicableGroups.map(g => g.id)
  }

  const availableTags = await prisma.tag.findMany({
    where: { deletedAt: null, groupId: { in: groupIds } },
    select: {
      id:      true,
      slug:    true,
      name:    true,
      groupId: true,
      group:   { select: { slug: true, name: true } },
    },
    orderBy: [{ groupId: 'asc' }, { slug: 'asc' }],
    take: 200,  // 硬上限，避免 prompt 过长
  })

  if (availableTags.length === 0) {
    return c.json({
      code: 0,
      data: { suggestions: [], model: 'n/a', appliedCount: apply ? 0 : undefined },
    }, 200)
  }

  const provider = buildProvider({
    provider: llmCfg.provider,
    apiKey:   llmCfg.apiKey,
    model:    modelOverride ?? llmCfg.model,
    baseUrl:  llmCfg.baseUrl,
  })

  // ── 4. 构建 prompt ────────────────────────────────────────────────────────
  const tagListJson = JSON.stringify(
    availableTags.map(t => ({
      id:    t.id,
      slug:  t.slug,
      name:  t.name,
      group: { slug: t.group.slug, name: t.group.name },
    })),
    null, 2,
  )

  const contextStr = Object.keys(effectiveContext).length > 0
    ? `\n上下文信息：\n${JSON.stringify(effectiveContext, null, 2)}`
    : ''

  const systemPrompt = `你是一个标签分配专家。你的任务是根据实体信息和可用标签列表，为实体推荐最合适的标签。

可用标签列表（JSON 格式）：
${tagListJson}

重要规则：
1. 只能从上面列表中选择标签，严禁返回列表外的 tagId
2. confidence 表示你对该建议的把握程度（0~1）
3. reasoning 用中文简洁说明推荐理由（≤80字）
4. 如果标签不适合，宁可不推荐，不要强行凑数
5. 同一分组的多个建议按置信度降序排列`

  const userPrompt = `实体类型：${entityType}
实体 ID：${entityId}${contextStr}

请为这个实体从可用标签列表中推荐最合适的标签。`

  // ── 5. 调用 LLM ──────────────────────────────────────────────────────────
  let llmOutput: z.infer<typeof LlmRawOutput>
  let actualModel: string
  try {
    const result = await provider.call({
      systemPrompt,
      userPrompt,
      outputSchema:      LLM_OUTPUT_SCHEMA as Record<string, unknown>,
      outputName:        'suggest_tags',
      outputDescription: '为实体推荐标签，每条包含 tagId、置信度和推荐理由',
    })
    actualModel = result.model

    const parsed = LlmRawOutput.safeParse(result.output)
    if (!parsed.success) {
      logger.warn({ raw: result.output, err: parsed.error }, 'LLM output failed Zod validation')
      return c.json({ code: 503, message: 'LLM 返回格式不符合预期，请稍后重试' }, 503)
    }
    llmOutput = parsed.data
  } catch (e) {
    logger.error({ err: e, entityType, entityId }, 'LLM call failed for suggest')
    if (e instanceof LlmError) {
      return c.json({ code: 503, message: `LLM 调用失败：${e.message}` }, 503)
    }
    throw e
  }

  // ── 6. 过滤 + 丰富 + topK ────────────────────────────────────────────────
  const tagMap = new Map(availableTags.map(t => [t.id, t]))

  const suggestions: z.infer<typeof SuggestionItem>[] = llmOutput.suggestions
    .filter(s => tagMap.has(s.tagId) && s.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topK)
    .map(s => {
      const t = tagMap.get(s.tagId)!
      return {
        tagId:      t.id,
        tagSlug:    t.slug,
        tagName:    t.name,
        groupId:    t.groupId,
        groupSlug:  t.group.slug,
        groupName:  t.group.name,
        confidence: s.confidence,
        reasoning:  s.reasoning,
      }
    })

  // ── 7. 可选：自动写入 pending EntityTag ───────────────────────────────────
  let appliedCount: number | undefined
  if (apply && suggestions.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.registeredEntity.upsert({
          where:  { entityType_entityId: { entityType, entityId } },
          create: { entityType, entityId },
          update: {},
        })
        await tx.entityTag.createMany({
          data: suggestions.map(s => ({
            tagId:      s.tagId,
            entityType,
            entityId,
            source:     'ai' as const,
            confidence: s.confidence,
            status:     'pending' as const,
          })),
          skipDuplicates: true,
        })
      })
      appliedCount = suggestions.length
    } catch (e) {
      logger.warn({ err: e, entityType, entityId }, 'suggest apply failed (non-fatal)')
      // apply 失败不影响主流程返回建议
    }
  }

  return c.json({
    code: 0,
    data: {
      suggestions,
      model:        actualModel,
      appliedCount: apply ? (appliedCount ?? 0) : undefined,
    },
  }, 200)
})
