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

export const RegisteredEntitySchema = z.object({
  entityType:   z.string(),
  entityId:     z.string(),
  registeredAt: DateTimeStr.optional(),  // タグフィルタパスでは返さない場合がある
  tags:         z.array(EntityTagItemSchema).optional(),
})

export const AddEntityTagBody = z.object({
  tagId:      CuidId,
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
