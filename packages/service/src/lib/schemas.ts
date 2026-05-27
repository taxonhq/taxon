/**
 * Single source of truth for request AND response schemas.
 *
 * These Zod schemas are used:
 *  1. In route handlers (via createRoute / c.req.valid) — runtime validation
 *  2. To generate the OpenAPI spec automatically via @hono/zod-openapi
 *  3. TypeScript types inferred via z.infer<typeof Schema>
 */

import { z } from '@hono/zod-openapi'

// ── Shared primitives ─────────────────────────────────────────────────────────
export const Slug   = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug 格式不合法（小写字母/数字，连字符下划线）')
export const Name   = z.string().min(1).max(50,  'name 不能超过 50 个字符')
export const Desc   = z.string().max(200, 'description 不能超过 200 个字符').optional()
export const CuidId = z.string().min(1)
export const DateTimeStr = z.string().datetime().or(z.string())  // ISO 8601

// ── Common response wrappers ──────────────────────────────────────────────────
export const OkMessage = z.object({
  code:    z.number().int(),
  message: z.string(),
})
export const ApiError = z.object({
  code:    z.number().int(),
  message: z.string(),
})
export const okData = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.number().int(), data })

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items:    z.array(item),
    total:    z.number().int(),
    page:     z.number().int(),
    pageSize: z.number().int(),
  })

// ── Pagination query params ───────────────────────────────────────────────────
export const PaginationQuery = z.object({
  page:     z.coerce.number().int().positive().default(1).optional(),
  pageSize: z.coerce.number().int().positive().max(100).default(20).optional(),
})

// ── TagGroup schemas ──────────────────────────────────────────────────────────
export const EntityRuleSchema = z.object({
  groupId:       z.string(),
  entityType:    z.string(),
  allowMultiple: z.boolean(),
})

export const TagGroupSchema = z.object({
  id:            z.string(),
  slug:          z.string(),
  name:          z.string(),
  description:   z.string().nullable(),
  entityScopes:  z.array(z.string()),
  allowMultiple: z.boolean(),
  sortOrder:     z.number().int(),
  createdAt:     DateTimeStr,
  updatedAt:     DateTimeStr,
  deletedAt:     DateTimeStr.nullable().optional(),
  entityRules:   z.array(EntityRuleSchema).optional(),
  _count:        z.object({ tags: z.number().int() }).optional(),
})

// Request bodies
export const CreateTagGroupBody = z.object({
  slug:          Slug,
  name:          Name,
  description:   Desc,
  entityScopes:  z.array(z.string().min(1)).default([]),
  allowMultiple: z.boolean().default(false),
  sortOrder:     z.number().int().default(0),
})

export const UpdateTagGroupBody = z.object({
  slug:          Slug.optional(),
  name:          Name.optional(),
  description:   Desc,
  entityScopes:  z.array(z.string().min(1)).optional(),
  allowMultiple: z.boolean().optional(),
  sortOrder:     z.number().int().optional(),
})

export const EntityRulesBody = z.object({
  rules: z.array(z.object({
    entityType:    z.string().min(1),
    allowMultiple: z.boolean(),
  })),
})

// ── Tag schemas ───────────────────────────────────────────────────────────────
export const TagAliasSchema = z.object({
  id:        z.string(),
  tagId:     z.string(),
  alias:     z.string(),
  source:    z.string(),
  createdAt: DateTimeStr,
})

export const TagGroupMiniSchema = z.object({
  id:   z.string(),
  slug: z.string(),
  name: z.string(),
})

export const TagSchema = z.object({
  id:          z.string(),
  groupId:     z.string(),
  slug:        z.string(),
  name:        z.string(),
  description: z.string().nullable(),
  parentId:    z.string().nullable(),
  path:        z.string(),
  depth:       z.number().int(),
  sortOrder:   z.number().int(),
  createdAt:   DateTimeStr,
  updatedAt:   DateTimeStr,
  deletedAt:   DateTimeStr.nullable().optional(),
  group:       TagGroupMiniSchema.optional(),
  _count:      z.object({ entityTags: z.number().int() }).optional(),
})

export const TagTreeNodeSchema: z.ZodType<{
  id: string; groupId: string; slug: string; name: string
  description: string | null; parentId: string | null; path: string
  depth: number; sortOrder: number; createdAt: string; updatedAt: string
  deletedAt?: string | null; aliases?: z.infer<typeof TagAliasSchema>[]
  children: unknown[]
}> = z.lazy(() =>
  TagSchema.extend({
    aliases:  z.array(TagAliasSchema).optional(),
    children: z.array(TagTreeNodeSchema),
  })
)

// Request bodies
export const CreateTagBody = z.object({
  groupId:     CuidId,
  name:        Name,
  slug:        Slug.optional(),
  description: Desc,
  parentId:    CuidId.optional(),
  sortOrder:   z.number().int().default(0),
})

export const UpdateTagBody = z.object({
  name:        Name.optional(),
  slug:        Slug.optional(),
  description: Desc,
  parentId:    CuidId.nullable().optional(),
  sortOrder:   z.number().int().optional(),
})

export const MergeTagBody = z.object({
  sourceId: CuidId,
})

export const MoveTagBody = z.object({
  targetGroupId: CuidId,
  newParentId:   CuidId.nullable().optional(),
})

// Alias request body
export const CreateAliasBody = z.object({
  alias:  z.string().min(1).max(100),
  source: z.enum(['manual', 'ai', 'import']).default('manual'),
})

// ── Entity schemas ────────────────────────────────────────────────────────────
export const EntityTagItemSchema = z.object({
  id:         z.string(),
  slug:       z.string(),
  name:       z.string(),
  groupId:    z.string(),
  group:      TagGroupMiniSchema,
  source:     z.string(),
  confidence: z.number().nullable(),
  status:     z.string(),
  taggedAt:   DateTimeStr,
})

// metadata: 业务方自定义的实体元数据，string 值的 KV map（name、description、imageUrl 等）
// 设计为 Record<string,string> 而非任意 JSON，便于 LLM prompt 序列化且不引入嵌套复杂度
export const EntityMetadata = z.record(z.string(), z.string())
  .openapi({ description: '实体元数据（name、description、imageUrl 等），由调用方自定义' })

export const RegisteredEntitySchema = z.object({
  entityType:   z.string(),
  entityId:     z.string(),
  registeredAt: DateTimeStr.optional(),  // タグフィルタパスでは返さない場合がある
  metadata:     EntityMetadata.nullable().optional(),
  tags:         z.array(EntityTagItemSchema).optional(),
})

// POST /entities/:type/:id 注册 / PATCH 更新 body
export const RegisterEntityBody = z.object({
  metadata: EntityMetadata.optional()
    .openapi({ description: '实体元数据，首次注册时提供；PATCH 时传入会覆盖全量替换' }),
})

// 路由是 POST /entities/:type/:id/tags/:tagId — tagId 在 URL 路径里，
// 不应再要求 body 也带 tagId（重复 + 阻塞空 body 的合法 POST）。
export const AddEntityTagBody = z.object({
  source:     z.enum(['manual', 'ai', 'system', 'import']).default('manual'),
  confidence: z.number().min(0).max(1).nullable().optional(),
  note:       z.string().max(500).optional(),
})

export const UpdateEntityTagBody = z.object({
  status:     z.enum(['active', 'pending', 'rejected']),
  note:       z.string().max(500).nullable().optional(),
})

export const ReplaceEntityTagsBody = z.object({
  tagIds:     z.array(z.string().min(1)),
  source:     z.enum(['manual', 'ai', 'system', 'import']).default('manual'),
  confidence: z.number().min(0).max(1).nullable().optional(),
  status:     z.enum(['active', 'pending', 'rejected']).optional(),
})

// Audit
export const AuditItemSchema = z.object({
  tagId:        z.string(),
  entityType:   z.string(),
  entityId:     z.string(),
  source:       z.string(),
  confidence:   z.number().nullable(),
  status:       z.string(),
  taggedAt:     DateTimeStr,
  reviewedAt:   DateTimeStr.nullable(),
  reviewNote:   z.string().nullable(),
  reviewerName: z.string().nullable(),
  tag: z.object({
    id:    z.string(),
    slug:  z.string(),
    name:  z.string(),
    group: TagGroupMiniSchema,
  }),
})

// Tag review history
export const TagReviewSchema = z.object({
  id:          z.string(),
  fromStatus:  z.string(),
  toStatus:    z.string(),
  note:        z.string().nullable(),
  reviewedAt:  DateTimeStr,
  reviewer:    z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
})

// ── Search schemas ────────────────────────────────────────────────────────────
// 布尔表达式 DSL：leaf 描述"该实体存在至少一条符合条件的 EntityTag"，
// and/or/not 组合成树。详见 issue #17。
const TagSourceEnum = z.enum(['manual', 'ai', 'system', 'import'])
const TagStatusEnum = z.enum(['active', 'pending', 'rejected'])

export type BoolExpr =
  | { tag: string }
  | { tagSlug: string; groupSlug?: string }
  | { tagAlias: string; groupSlug?: string }
  | { descendantOf: string }
  | { source: ('manual' | 'ai' | 'system' | 'import')[] }
  | { confidence: { gte?: number; lte?: number } }
  | { status: ('active' | 'pending' | 'rejected')[] }
  | { and: BoolExpr[] }
  | { or:  BoolExpr[] }
  | { not: BoolExpr }

export const BoolExprSchema: z.ZodType<BoolExpr> = z.lazy(() =>
  z.union([
    z.object({ tag:          z.string().min(1) }).strict(),
    z.object({ tagSlug:      z.string().min(1), groupSlug: z.string().min(1).optional() }).strict(),
    z.object({ tagAlias:     z.string().min(1), groupSlug: z.string().min(1).optional() }).strict(),
    z.object({ descendantOf: z.string().min(1) }).strict(),
    z.object({ source:       z.array(TagSourceEnum).min(1) }).strict(),
    z.object({ confidence:   z.object({ gte: z.number().min(0).max(1).optional(), lte: z.number().min(0).max(1).optional() }).strict() }).strict(),
    z.object({ status:       z.array(TagStatusEnum).min(1) }).strict(),
    z.object({ and: z.array(BoolExprSchema).min(1) }).strict(),
    z.object({ or:  z.array(BoolExprSchema).min(1) }).strict(),
    z.object({ not: BoolExprSchema }).strict(),
  ])
).openapi('BoolExpr')

export const SearchEntitiesBody = z.object({
  entityType: z.string().min(1).openapi({ description: '实体类型，必填' }),
  filter:     BoolExprSchema.optional().openapi({ description: '标签布尔表达式（缺省=全集）' }),
  page:       z.number().int().positive().default(1).openapi({ description: '页码' }),
  pageSize:   z.number().int().positive().max(100).default(20).openapi({ description: '每页条数' }),
  sort:       z.enum(['registeredAt:desc', 'registeredAt:asc', 'taggedAt:desc', 'taggedAt:asc']).default('registeredAt:desc').openapi({ description: '排序字段' }),
  include:    z.array(z.enum(['tags'])).default([]).openapi({ description: '附加返回字段' }),
  facets:     z.array(z.enum(['groupId'])).default([]).openapi({ description: '需要聚合的 facet 维度' }),
}).openapi({ description: '多维检索请求' })

export const SearchEntityItemSchema = z.object({
  entityType:   z.string(),
  entityId:     z.string(),
  registeredAt: DateTimeStr,
  tags:         z.array(EntityTagItemSchema).optional(),
})

export const FacetTagItemSchema = z.object({
  tagId:    z.string(),
  tagSlug:  z.string(),
  tagName:  z.string(),
  groupId:  z.string(),
  count:    z.number().int(),
})

export const SearchEntitiesDataSchema = z.object({
  items:    z.array(SearchEntityItemSchema),
  total:    z.number().int(),
  page:     z.number().int(),
  pageSize: z.number().int(),
  facets:   z.record(z.string(), z.record(z.string(), z.array(FacetTagItemSchema))).optional(),
})

export type SearchEntitiesInput = z.infer<typeof SearchEntitiesBody>

// ── Pivot 交叉透视 schemas ────────────────────────────────────────────────────
// 二维标签透视：选两个 group 作为 X/Y 轴，每个 cell 是"同时持有该 row tag 和
// col tag 的活跃实体数"。详见 #17 设计扩展（控制台 showcase）。
export const SearchPivotBody = z.object({
  entityType:   z.string().min(1).openapi({ description: '实体类型，必填' }),
  rowGroupSlug: z.string().min(1).openapi({ description: '行维度的 TagGroup slug（X 轴）' }),
  colGroupSlug: z.string().min(1).openapi({ description: '列维度的 TagGroup slug（Y 轴）' }),
  filter:       BoolExprSchema.optional().openapi({ description: '可选 BoolExpr 限定子集' }),
  topN:         z.number().int().positive().max(50).default(20).openapi({ description: '每个维度只取实体数最多的 top-N 标签（避免巨表）' }),
}).openapi({ description: 'Pivot 透视请求' })

export const PivotAxisItemSchema = z.object({
  tagId:    z.string(),
  slug:     z.string(),
  name:     z.string(),
  total:    z.number().int().openapi({ description: '该维度上该标签的总实体数（不区分另一维）' }),
})

export const SearchPivotDataSchema = z.object({
  rows:           z.array(PivotAxisItemSchema).openapi({ description: '行维度 top-N 标签' }),
  cols:           z.array(PivotAxisItemSchema).openapi({ description: '列维度 top-N 标签' }),
  // cells: 稀疏存储，key 形如 "<rowTagId>:<colTagId>"
  cells:          z.record(z.string(), z.number().int()).openapi({ description: 'cell 计数，key=`<rowTagId>:<colTagId>`，0 值省略' }),
  grandTotal:     z.number().int().openapi({ description: '该 entityType 下的实体总数（含未打这两维标签的）' }),
  uncategorized:  z.object({
    row: z.number().int().openapi({ description: '在 rowGroup 下无标签的实体数' }),
    col: z.number().int().openapi({ description: '在 colGroup 下无标签的实体数' }),
  }),
})

export type SearchPivotInput = z.infer<typeof SearchPivotBody>

// ── 共现矩阵 schemas ───────────────────────────────────────────────────────
// 同一组实体下，"哪些标签倾向同时出现"。对称矩阵，对角线 = 该标签自身总数。
// lift = (共现实体数 × 总实体数) / (tagA 总数 × tagB 总数)
//   > 1: 正相关（一起出现的概率高于随机）；= 1: 独立；< 1: 负相关
export const SearchCooccurrenceBody = z.object({
  entityType: z.string().min(1).openapi({ description: '实体类型' }),
  filter:     BoolExprSchema.optional().openapi({ description: '可选 BoolExpr 限定子集' }),
  topN:       z.number().int().positive().max(30).default(15).openapi({ description: '取使用量最大的 top-N 标签（控制矩阵规模，最大 30×30）' }),
}).openapi({ description: '共现矩阵请求' })

export const CooccurrenceTagSchema = z.object({
  tagId:     z.string(),
  slug:      z.string(),
  name:      z.string(),
  groupSlug: z.string(),
  groupName: z.string(),
  total:     z.number().int().openapi({ description: '该 tag 在子集中的活跃实体数' }),
})

export const CooccurrenceCellSchema = z.object({
  count: z.number().int().openapi({ description: '同时持有 tagA 与 tagB 的实体数' }),
  lift:  z.number().openapi({ description: '观察共现 / 期望共现；> 1 = 正相关' }),
})

export const SearchCooccurrenceDataSchema = z.object({
  tags:          z.array(CooccurrenceTagSchema),
  // key: "tagAId:tagBId"（tagAId < tagBId 字典序，对称矩阵只存一半）
  cooccurrence:  z.record(z.string(), CooccurrenceCellSchema),
  totalEntities: z.number().int(),
})

export type SearchCooccurrenceInput = z.infer<typeof SearchCooccurrenceBody>

// ── LLM 配置 schemas ──────────────────────────────────────────────────────────
// 用 SystemConfig 表存储，key='llm-config'，value 为以下结构（apiKey 字段已加密）。
export const LlmProviderEnum = z.enum(['anthropic', 'openai'])

// 内部存储格式（DB 中的 value）
export const LlmConfigStored = z.object({
  provider: LlmProviderEnum,
  model:    z.string().min(1),
  apiKey:   z.string(),     // 已 AES-256-GCM 加密
  baseUrl:  z.string().optional(),
  enabled:  z.boolean(),
})
export type LlmConfigStored = z.infer<typeof LlmConfigStored>

// GET 响应：apiKey 用 mask 返回
export const LlmConfigPublic = z.object({
  provider:   LlmProviderEnum.optional(),
  model:      z.string().optional(),
  baseUrl:    z.string().optional(),
  hasApiKey:  z.boolean(),
  apiKeyMask: z.string().optional(),
  enabled:    z.boolean(),
})

// PUT 请求：apiKey 可缺省表示保持原值；空字符串表示清空
export const LlmConfigUpdateBody = z.object({
  provider: LlmProviderEnum,
  model:    z.string().min(1),
  apiKey:   z.string().optional().openapi({ description: '明文 API key；缺省=保持原值；空字符串=清空' }),
  baseUrl:  z.string().optional(),
  enabled:  z.boolean(),
})

// ── AI 标签建议 schemas ────────────────────────────────────────────────────────
export const SuggestBody = z.object({
  groups:        z.array(z.string().min(1)).optional()
                   .openapi({ description: '限定分组 slug 或 ID（缺省=所有对该 entityType 适用的分组）' }),
  context:       z.record(z.string(), z.string()).optional()
                   .openapi({ description: '业务上下文键值对（name, description 等），原样传给 LLM' }),
  model:         z.string().optional()
                   .openapi({ description: '覆盖 /settings/llm 里配置的模型名称' }),
  topK:          z.number().int().positive().max(20).default(5).optional()
                   .openapi({ description: '最多返回几条建议，默认 5，最大 20' }),
  minConfidence: z.number().min(0).max(1).default(0).optional()
                   .openapi({ description: '过滤低置信度建议，默认 0（全部返回）' }),
  apply:         z.boolean().default(false).optional()
                   .openapi({ description: '为 true 时自动将建议写入为 pending 状态的 EntityTag' }),
})

export const SuggestionItem = z.object({
  tagId:      z.string().openapi({ description: '标签 ID' }),
  tagSlug:    z.string().openapi({ description: '标签 slug' }),
  tagName:    z.string().openapi({ description: '标签名称' }),
  groupId:    z.string().openapi({ description: '分组 ID' }),
  groupSlug:  z.string().openapi({ description: '分组 slug' }),
  groupName:  z.string().openapi({ description: '分组名称' }),
  confidence: z.number().min(0).max(1).openapi({ description: '置信度 0~1' }),
  reasoning:  z.string().openapi({ description: 'LLM 给出的推荐理由' }),
})

export const SuggestData = z.object({
  suggestions:  z.array(SuggestionItem),
  model:        z.string().openapi({ description: '实际生效的模型（带 provider 前缀）' }),
  appliedCount: z.number().int().optional()
                  .openapi({ description: '自动写入的 pending EntityTag 数量（apply=true 时有值）' }),
})

export type SuggestInput = z.infer<typeof SuggestBody>

// ── NL → BoolExpr 路由 schemas ────────────────────────────────────────────────
export const NlToDslBody = z.object({
  text:       z.string().min(1).openapi({ description: '中文自然语言查询，例如：「川菜餐厅但不要素食的，AI 高置信度」' }),
  entityType: z.string().min(1).optional().openapi({ description: '可选：实体类型上下文，提升翻译准确率' }),
})

export const NlToDslData = z.object({
  boolExpr:    BoolExprSchema.optional().openapi({ description: '解析得到的 BoolExpr；空 = 模型未能解析' }),
  explanation: z.string().openapi({ description: 'AI 对翻译过程的中文解释，便于审计' }),
  model:       z.string().openapi({ description: '实际使用的模型版本（带 provider 前缀）' }),
})

export type LlmConfigUpdateInput = z.infer<typeof LlmConfigUpdateBody>
export type NlToDslInput         = z.infer<typeof NlToDslBody>

// ── Token schemas ─────────────────────────────────────────────────────────────
export const ApiTokenSchema = z.object({
  id:         z.string(),
  name:       z.string(),
  role:       z.string(),
  scopes:     z.array(z.string()),
  createdAt:  DateTimeStr,
  lastUsedAt: DateTimeStr.nullable(),
  revokedAt:  DateTimeStr.nullable(),
})

export const CreateTokenBody = z.object({
  name:      z.string().min(1).max(100),
  role:      z.enum(['admin', 'writer', 'reviewer', 'reader']).default('reader'),
  scopes:    z.array(z.string()).default([]),
})

export const CreatedTokenSchema = ApiTokenSchema.extend({
  token: z.string().describe('一次性明文 token，创建后不可再查'),
})

// ── Type exports ──────────────────────────────────────────────────────────────
export type CreateTagGroupInput    = z.infer<typeof CreateTagGroupBody>
export type UpdateTagGroupInput    = z.infer<typeof UpdateTagGroupBody>
export type EntityRulesInput       = z.infer<typeof EntityRulesBody>
export type CreateTagInput         = z.infer<typeof CreateTagBody>
export type UpdateTagInput         = z.infer<typeof UpdateTagBody>
export type MergeTagInput          = z.infer<typeof MergeTagBody>
export type MoveTagInput           = z.infer<typeof MoveTagBody>
export type AddEntityTagInput      = z.infer<typeof AddEntityTagBody>
export type UpdateEntityTagInput   = z.infer<typeof UpdateEntityTagBody>
export type ReplaceEntityTagsInput = z.infer<typeof ReplaceEntityTagsBody>
export type CreateTokenInput       = z.infer<typeof CreateTokenBody>
