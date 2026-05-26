/**
 * 自然语言 → BoolExpr 翻译核心逻辑。
 *
 * 流程：
 *   1) 拼上下文：实体类型 + 现有分组 / 标签 / 别名（供 LLM 参考实际名字）
 *   2) 把 BoolExpr Zod schema 转为 JSON Schema，作为结构化输出 schema
 *   3) 调 LLM 一次（tool use / json_schema），拿 boolExpr + 解释
 *   4) 二次 Zod 校验 LLM 输出，不通过则返回 boolExpr=undefined + 错误说明
 */
import prisma from './db.js'
import { BoolExprSchema, type NlToDslInput } from './schemas.js'
import type { LlmProvider } from './llm/index.js'

// BoolExpr 的 JSON Schema（手写比 zod-to-json-schema 更紧凑、对 LLM 更友好）
// 注意：用 "oneOf" 描述 union；嵌套通过 $ref 引用自身实现。
const BOOL_EXPR_JSON_SCHEMA: Record<string, unknown> = {
  $defs: {
    BoolExpr: {
      oneOf: [
        { type: 'object', required: ['tag'],          properties: { tag: { type: 'string' } },          additionalProperties: false },
        { type: 'object', required: ['tagSlug'],      properties: { tagSlug: { type: 'string' }, groupSlug: { type: 'string' } }, additionalProperties: false },
        { type: 'object', required: ['tagAlias'],     properties: { tagAlias: { type: 'string' }, groupSlug: { type: 'string' } }, additionalProperties: false },
        { type: 'object', required: ['descendantOf'], properties: { descendantOf: { type: 'string' } }, additionalProperties: false },
        { type: 'object', required: ['source'],       properties: { source: { type: 'array', items: { enum: ['manual', 'ai', 'system', 'import'] }, minItems: 1 } }, additionalProperties: false },
        { type: 'object', required: ['confidence'],   properties: { confidence: { type: 'object', properties: { gte: { type: 'number', minimum: 0, maximum: 1 }, lte: { type: 'number', minimum: 0, maximum: 1 } }, additionalProperties: false } }, additionalProperties: false },
        { type: 'object', required: ['status'],       properties: { status: { type: 'array', items: { enum: ['active', 'pending', 'rejected'] }, minItems: 1 } }, additionalProperties: false },
        { type: 'object', required: ['and'], properties: { and: { type: 'array', items: { $ref: '#/$defs/BoolExpr' }, minItems: 1 } }, additionalProperties: false },
        { type: 'object', required: ['or'],  properties: { or:  { type: 'array', items: { $ref: '#/$defs/BoolExpr' }, minItems: 1 } }, additionalProperties: false },
        { type: 'object', required: ['not'], properties: { not: { $ref: '#/$defs/BoolExpr' } },                                      additionalProperties: false },
      ],
    },
  },
  type: 'object',
  properties: {
    boolExpr:    { anyOf: [{ $ref: '#/$defs/BoolExpr' }, { type: 'null' }] },
    explanation: { type: 'string', description: '一句中文解释为什么这样翻译；如果无法翻译，说明卡在哪里' },
  },
  required: ['boolExpr', 'explanation'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `你是 Taxon 标签系统的"自然语言 → 查询表达式"翻译器。

用户用中文描述他想找的实体，你的工作是把它翻译为 BoolExpr。

BoolExpr 是一个 JSON 树，叶子节点是以下几种之一：
- { "tag": "<tagId>" }                            按确切 tagId 匹配
- { "tagSlug": "<slug>", "groupSlug"?: "<...>" } 按 tag slug（最常用）
- { "tagAlias": "<alias>", "groupSlug"?: "<...>" } 按别名（一个 alias 可能命中多个 tag）
- { "descendantOf": "<tagId>" }                  匹配该节点或任意子孙
- { "source": ["manual"|"ai"|"system"|"import",...] }  按打标来源
- { "confidence": { "gte"?: 0~1, "lte"?: 0~1 } } 按 AI 置信度区间
- { "status": ["active"|"pending"|"rejected",...] } 按状态

组合节点：
- { "and": [expr, expr, ...] }
- { "or":  [expr, expr, ...] }
- { "not": expr }

规则：
1. 优先用 tagSlug + groupSlug，因为更直观、跨环境稳定。
2. 同一个分组内的多个选项（例如"川菜或湘菜"）用 or。
3. 跨分组的条件（例如"川菜且非素食"）用 and。
4. 用户说"不要 / 排除 / 除了"的，包成 not。
5. "AI 高置信度" = confidence ≥ 0.7。
6. "待审核" = status:["pending"]；"已审核 / 生效" = status:["active"]。
7. 如果用户提到的标签名不在下面的上下文里，仍按你最接近的猜测输出，后端会做匹配；不要因此放弃。

【绝对要求】
你必须**始终输出有效的 boolExpr JSON 结构**，不要返回 null。即使你不确定某个标签是否存在，按你的最佳猜测输出对应的 tagSlug 即可。仅在用户输入完全无法解析为查询（例如"你好"、"今天天气怎么样"）时才返回 null。

—— 必须遵循的输出示例 ——

输入: "找川菜"
输出: { "boolExpr": { "tagSlug": "sichuan", "groupSlug": "cuisine" }, "explanation": "查询菜系=川菜" }

输入: "蒸或炖的菜"
输出: { "boolExpr": { "or": [ { "tagSlug": "steam", "groupSlug": "cooking" }, { "tagSlug": "braise", "groupSlug": "cooking" } ] }, "explanation": "烹饪方式为蒸或炖" }

输入: "麻辣鲜香的川菜"
输出: { "boolExpr": { "and": [ { "tagSlug": "sichuan", "groupSlug": "cuisine" }, { "tagSlug": "mala-savory", "groupSlug": "taste" } ] }, "explanation": "川菜 + 麻辣鲜香口味" }

输入: "热菜但不要川菜"
输出: { "boolExpr": { "and": [ { "tagSlug": "hot-dish", "groupSlug": "category" }, { "not": { "tagSlug": "sichuan", "groupSlug": "cuisine" } } ] }, "explanation": "热菜，排除川菜" }

输入: "AI 高置信度的菜"
输出: { "boolExpr": { "and": [ { "source": ["ai"] }, { "confidence": { "gte": 0.7 } } ] }, "explanation": "AI 来源且置信度 ≥ 0.7" }
`

interface TagContextRow {
  slug: string
  name: string
  groupSlug: string
  groupName: string
  aliasList: string[]
}

async function buildContext(entityType?: string): Promise<string> {
  // 取活跃 group + 每个 group top tags + 别名，供 LLM 参考实际命名
  const groups = await prisma.tagGroup.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, name: true, entityScopes: true },
    take: 20,
  })

  // 若指定 entityType，过滤 group 至 entityScopes 兼容
  const applicableGroups = entityType
    ? groups.filter(g => g.entityScopes.length === 0 || g.entityScopes.includes(entityType))
    : groups

  const rows: (TagContextRow & { entityCount: number })[] = []
  for (const g of applicableGroups.slice(0, 12)) {
    // 按"实际有使用的标签数"排序——0 实体的死标签往后排，避免占满上下文窗口。
    // 这是 LLM 翻译准确率的关键：模型只能看到我们喂进来的标签，看不见的等于"不存在"。
    const tags = await prisma.tag.findMany({
      where: { groupId: g.id, deletedAt: null },
      include: {
        aliases: { select: { alias: true }, take: 5 },
        _count:  { select: { entityTags: { where: { status: 'active' } } } },
      },
      take: 100,  // 先多取，下面按 entityCount 排序后再截断
    })
    // 排序：有使用量的优先（desc），无使用量的按 sortOrder
    tags.sort((a, b) => {
      const ca = a._count.entityTags
      const cb = b._count.entityTags
      if (ca !== cb) return cb - ca
      return a.sortOrder - b.sortOrder
    })
    // 每个 group 最多保留 20 个，并把至少 1 个实体的全部保留（避免漏掉冷门但实际存在的）
    const used    = tags.filter(t => t._count.entityTags > 0)
    const unused  = tags.filter(t => t._count.entityTags === 0)
    const keep    = [...used, ...unused.slice(0, Math.max(0, 20 - used.length))]
    for (const t of keep) {
      rows.push({
        slug: t.slug, name: t.name,
        groupSlug: g.slug, groupName: g.name,
        aliasList: t.aliases.map(a => a.alias),
        entityCount: t._count.entityTags,
      })
    }
  }

  const lines = rows.map(r => {
    const a = r.aliasList.length > 0 ? `  (别名: ${r.aliasList.join(' / ')})` : ''
    const c = r.entityCount > 0 ? `  [使用: ${r.entityCount}]` : ''
    return `- [${r.groupSlug}] ${r.name} (slug=${r.slug})${c}${a}`
  })

  let header = `以下是当前系统中可用的标签上下文`
  if (entityType) header += `（实体类型: ${entityType}）`
  return `${header}：\n${lines.join('\n')}`
}

export interface NlTranslationResult {
  boolExpr:    unknown   // 未校验，调用方做 Zod
  explanation: string
  model:       string
  text:        string    // LLM 的 free-text（如有）
}

// 从任意 LLM 文本响应中提取 JSON 对象。
// 兼容：纯 JSON / ```json ... ``` 代码块 / 包在散文里的 JSON 对象。
function extractJson(text: string): unknown | null {
  if (!text) return null
  // 1) 尝试 ```json fenced block
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]+?)\n```/i)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fallthrough */ }
  }
  // 2) 找首个 { 到最后一个 } 之间的内容
  const first = text.indexOf('{')
  const last  = text.lastIndexOf('}')
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1)
    try { return JSON.parse(candidate) } catch { /* fallthrough */ }
  }
  // 3) 整个 text 就是合法 JSON
  try { return JSON.parse(text.trim()) } catch { return null }
}

export async function translateNlToDsl(
  llm: LlmProvider,
  input: NlToDslInput,
): Promise<NlTranslationResult> {
  const ctx = await buildContext(input.entityType)
  const userPrompt = `${ctx}\n\n用户的查询：\n${input.text}\n\n请翻译为 BoolExpr。`

  // ── 第一次：结构化输出（tool use / json_schema）
  const result = await llm.call({
    systemPrompt:      SYSTEM_PROMPT,
    userPrompt,
    outputName:        'TranslatedQuery',
    outputDescription: '把自然语言查询翻译为 BoolExpr 的结果',
    outputSchema:      BOOL_EXPR_JSON_SCHEMA,
  })

  const o = result.output as { boolExpr?: unknown; explanation?: string } | null
  let boolExpr   : unknown = o?.boolExpr ?? null
  let explanation: string  = typeof o?.explanation === 'string' ? o.explanation : ''

  // ── Fallback：tool use 没填 boolExpr（minimax / 中转层 / 不支持 tool use 的模型）
  //    改用 plain text 调用，让模型直接输出完整 JSON。
  if (boolExpr === null || boolExpr === undefined) {
    const plainSystem = `${SYSTEM_PROMPT}\n\n注意：直接输出一个 JSON 对象（无任何 markdown 包装），形如 {"boolExpr": <BoolExpr>, "explanation": "..."}。不要写任何解释性文字。`
    const plainResult = await llm.callPlain({
      systemPrompt: plainSystem,
      userPrompt,
    })
    const extracted = extractJson(plainResult.text)
    if (extracted && typeof extracted === 'object' && extracted !== null) {
      const e = extracted as { boolExpr?: unknown; explanation?: string }
      if (e.boolExpr !== undefined && e.boolExpr !== null) {
        boolExpr = e.boolExpr
        if (typeof e.explanation === 'string' && e.explanation) {
          explanation = e.explanation
        }
      }
    }
  }

  return {
    boolExpr,
    explanation,
    model:  result.model,
    text:   result.text,
  }
}

/** 二次校验：把 LLM 输出的 boolExpr 跑一遍 Zod schema */
export function validateBoolExpr(raw: unknown): unknown | null {
  if (raw === null || raw === undefined) return null
  const parsed = BoolExprSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
