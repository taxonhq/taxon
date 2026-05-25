/**
 * 多维检索 POST /search/entities
 *
 * 支持布尔表达式（tag/tagSlug/tagAlias/descendantOf/source/confidence/status + and/or/not），
 * 分页、排序、可选 tag 富数据、按 group 聚合 facet。详见 issue #17。
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import {
  SearchEntitiesBody, SearchEntitiesDataSchema,
  ApiError, okData,
} from '../lib/schemas.js'
import { compileBoolExpr } from '../lib/search/compile.js'

export const searchRouter = new OpenAPIHono()

// ── POST /entities ────────────────────────────────────────────────────────────
const SEARCH_DESCRIPTION = `
基于 BoolExpr DSL 检索实体。

### BoolExpr leaf 类型

| leaf | 含义 | 备注 |
|------|------|------|
| \`{ "tag": "<tagId>" }\` | 实体持有该 tagId | 精确匹配 |
| \`{ "tagSlug": "<slug>", "groupSlug": "<groupSlug>?" }\` | 按 slug 匹配 | 不指定 groupSlug 时跨 group 全部命中 |
| \`{ "tagAlias": "<alias>", "groupSlug": "<groupSlug>?" }\` | 经别名匹配 | 依赖 TagAlias 表 |
| \`{ "descendantOf": "<tagId>" }\` | 该节点或其任意子孙 | 用 path 前缀匹配 |
| \`{ "source": ["manual","ai",...] }\` | 至少有一条 EntityTag 来自指定 source | |
| \`{ "confidence": { "gte": 0.7, "lte": 1 } }\` | 至少一条 EntityTag 置信度落区间 | gte / lte 均可缺省 |
| \`{ "status": ["active","pending","rejected"] }\` | 状态在列表内 | 其他 leaf 默认 status=active |
| \`{ "and": [...] }\` / \`{ "or": [...] }\` / \`{ "not": <expr> }\` | 布尔组合 | 可嵌套任意深度 |

### 注意
- 每个 leaf 是独立 EXISTS 子查询，不要求"同一条 EntityTag 同时满足多个 leaf"。
  例：\`and: [{tag:"X"}, {source:["ai"]}]\` 表示"既被打过 X 标签，也存在至少一条 AI 来源标签"——可能不是同一条记录。
- \`tagSlug\` / \`tagAlias\` / \`descendantOf\` 解析后若得不到任何 tagId，正向 leaf 永远不命中；包在 \`not\` 中时永远命中。
- 缺省 \`filter\` 即返回该 entityType 下全部已注册实体（仍受分页限制）。
`.trim()

const exampleSimple = {
  summary: '1. 单标签精确匹配',
  value: {
    entityType: 'dish',
    filter: { tag: 'clxxx_tag_sichuan' },
  },
}

const exampleSlug = {
  summary: '2. 按 slug 检索（更直观）',
  value: {
    entityType: 'dish',
    filter: { tagSlug: 'sichuan', groupSlug: 'cuisine' },
    page: 1, pageSize: 20,
  },
}

const exampleOr = {
  summary: '3. OR：川菜 或 湘菜',
  value: {
    entityType: 'dish',
    filter: {
      or: [
        { tagSlug: 'sichuan', groupSlug: 'cuisine' },
        { tagSlug: 'hunan',   groupSlug: 'cuisine' },
      ],
    },
  },
}

const exampleAndNot = {
  summary: '4. AND + NOT：川菜 且 非素食',
  value: {
    entityType: 'dish',
    filter: {
      and: [
        { tagSlug: 'sichuan', groupSlug: 'cuisine' },
        { not: { tagSlug: 'vegan', groupSlug: 'dietary' } },
      ],
    },
  },
}

const exampleNested = {
  summary: '5. 嵌套：(川菜 OR 湘菜) AND NOT 素食 AND 高置信度（issue #17 示例）',
  value: {
    entityType: 'dish',
    filter: {
      and: [
        { or: [
          { tagSlug: 'sichuan', groupSlug: 'cuisine' },
          { tagSlug: 'hunan',   groupSlug: 'cuisine' },
        ]},
        { not: { tagSlug: 'vegan', groupSlug: 'dietary' } },
        { confidence: { gte: 0.7 } },
      ],
    },
    page: 1, pageSize: 20,
    sort: 'taggedAt:desc',
    include: ['tags'],
    facets: ['groupId'],
  },
}

const exampleDescendant = {
  summary: '6. 层级：所有"中餐"子孙菜系（含子节点）',
  value: {
    entityType: 'dish',
    filter: { descendantOf: 'clxxx_tag_chinese' },
  },
}

const exampleAlias = {
  summary: '7. 别名：用"麻辣"匹配（命中所有挂了该别名的 tag）',
  value: {
    entityType: 'dish',
    filter: { tagAlias: '麻辣' },
  },
}

const exampleConfidenceRange = {
  summary: '8. 置信度区间：AI 不太确定的（0.5 ~ 0.8）',
  value: {
    entityType: 'dish',
    filter: {
      and: [
        { source: ['ai'] },
        { confidence: { gte: 0.5, lte: 0.8 } },
      ],
    },
  },
}

const exampleAuditFlow = {
  summary: '9. 审核流：所有待审核的 AI 标签实体',
  value: {
    entityType: 'dish',
    filter: {
      and: [
        { source: ['ai'] },
        { status: ['pending'] },
      ],
    },
    include: ['tags'],
  },
}

const exampleFacetsOnly = {
  summary: '10. 仅看分布：返回 dish 全集 + 按 group 聚合的 facet（pageSize=0 不要 items）',
  value: {
    entityType: 'dish',
    pageSize: 1,
    facets: ['groupId'],
  },
}

const exampleResponse = {
  code: 0,
  data: {
    items: [
      {
        entityType: 'dish',
        entityId: 'dish_001',
        registeredAt: '2026-05-20T10:30:00.000Z',
        tags: [
          {
            id: 'clxxx_tag_sichuan', slug: 'sichuan', name: '川菜',
            groupId: 'clxxx_grp_cuisine',
            group: { id: 'clxxx_grp_cuisine', slug: 'cuisine', name: '菜系' },
            source: 'manual', confidence: null, status: 'active',
            taggedAt: '2026-05-21T08:15:00.000Z',
          },
        ],
      },
    ],
    total: 87,
    page: 1,
    pageSize: 20,
    facets: {
      groupId: {
        cuisine: [
          { tagId: 'clxxx_tag_sichuan', tagSlug: 'sichuan', tagName: '川菜', groupId: 'clxxx_grp_cuisine', count: 87 },
          { tagId: 'clxxx_tag_hunan',   tagSlug: 'hunan',   tagName: '湘菜', groupId: 'clxxx_grp_cuisine', count: 41 },
        ],
        dietary: [
          { tagId: 'clxxx_tag_spicy', tagSlug: 'spicy', tagName: '辣', groupId: 'clxxx_grp_dietary', count: 73 },
        ],
      },
    },
  },
}

const searchEntitiesRoute = createRoute({
  method: 'post', path: '/entities',
  tags: ['检索'],
  summary: '多维检索（布尔表达式 + 分页 + facet）',
  description: SEARCH_DESCRIPTION,
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: SearchEntitiesBody,
          examples: {
            simple:          exampleSimple,
            slug:            exampleSlug,
            or:              exampleOr,
            andNot:          exampleAndNot,
            nested:          exampleNested,
            descendant:      exampleDescendant,
            alias:           exampleAlias,
            confidenceRange: exampleConfidenceRange,
            auditFlow:       exampleAuditFlow,
            facetsOnly:      exampleFacetsOnly,
          },
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: okData(SearchEntitiesDataSchema),
          examples: { success: { summary: '典型响应（含 tags + facets）', value: exampleResponse } },
        },
      },
    },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
})

searchRouter.use('/entities', requireRole('reader'))
searchRouter.openapi(searchEntitiesRoute, async (c) => {
  const body = c.req.valid('json')
  const { entityType, filter, page, pageSize, sort, include, facets } = body
  const offset = (page - 1) * pageSize

  try {
    // 1) 编译过滤表达式（缺省=无过滤）
    const filterSql = filter
      ? Prisma.sql`AND ${await compileBoolExpr(filter)}`
      : Prisma.empty

    // 2) 排序：根据 sort 字段选择列
    //    - registeredAt:* → 直接用 re."registeredAt"
    //    - taggedAt:*     → 用子查询取该实体的 max(createdAt)
    const orderBy = (() => {
      const [field, dir] = sort.split(':') as [string, 'asc' | 'desc']
      const direction = dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
      if (field === 'taggedAt') {
        return Prisma.sql`ORDER BY (
          SELECT MAX(et2."createdAt") FROM "EntityTag" et2
          WHERE et2."entityType" = re."entityType" AND et2."entityId" = re."entityId"
        ) ${direction} NULLS LAST, re."entityId" ASC`
      }
      return Prisma.sql`ORDER BY re."registeredAt" ${direction}, re."entityId" ASC`
    })()

    // 3) 主查询 + 总数（COUNT 不需要 ORDER BY/LIMIT）
    type ItemRow = { entityType: string; entityId: string; registeredAt: Date }
    type CountRow = { count: bigint }

    const [items, countRows] = await Promise.all([
      prisma.$queryRaw<ItemRow[]>(Prisma.sql`
        SELECT re."entityType", re."entityId", re."registeredAt"
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
        ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
      `),
    ])
    const total = Number(countRows[0]?.count ?? 0)

    // 4) 可选：include=tags，按当前页 N 个实体批量取活跃标签
    type TagItem = {
      id: string; slug: string; name: string; groupId: string
      source: string; confidence: number | null; status: string; taggedAt: string
      group: { id: string; slug: string; name: string }
    }
    const tagsByEntity = new Map<string, TagItem[]>()
    if (include.includes('tags') && items.length > 0) {
      const ids = items.map(i => i.entityId)
      const entityTags = await prisma.entityTag.findMany({
        where: { entityType, entityId: { in: ids }, status: 'active', tag: { deletedAt: null } },
        include: { tag: { select: { id: true, slug: true, name: true, groupId: true, group: { select: { id: true, slug: true, name: true } } } } },
      })
      for (const et of entityTags) {
        const k = et.entityId
        if (!tagsByEntity.has(k)) tagsByEntity.set(k, [])
        tagsByEntity.get(k)!.push({
          id:         et.tag.id,
          slug:       et.tag.slug,
          name:       et.tag.name,
          groupId:    et.tag.groupId,
          source:     et.source,
          confidence: et.confidence,
          status:     et.status,
          taggedAt:   et.createdAt.toISOString(),
          group:      et.tag.group,
        })
      }
    }

    // 5) 可选：facets（当前实现 groupId 维度）
    type FacetMap = Record<string, Record<string, Array<{
      tagId: string; tagSlug: string; tagName: string; groupId: string; count: number
    }>>>
    let facetData: FacetMap | undefined
    if (facets.length > 0) {
      // facet 在"应用了 filter 的实体子集"上聚合
      type FacetRow = {
        tagId: string; tagSlug: string; tagName: string
        groupId: string; groupSlug: string
        cnt: bigint
      }
      const rows = await prisma.$queryRaw<FacetRow[]>(Prisma.sql`
        SELECT t.id AS "tagId", t.slug AS "tagSlug", t.name AS "tagName",
               t."groupId" AS "groupId", g.slug AS "groupSlug",
               COUNT(DISTINCT et."entityId")::bigint AS cnt
        FROM "EntityTag" et
        JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
        JOIN "TagGroup" g ON g.id = t."groupId" AND g."deletedAt" IS NULL
        WHERE et."entityType" = ${entityType}
          AND et."status" = 'active'
          AND EXISTS (
            SELECT 1 FROM "RegisteredEntity" re
            WHERE re."entityType" = et."entityType"
              AND re."entityId"   = et."entityId"
              ${filterSql}
          )
        GROUP BY t.id, t.slug, t.name, t."groupId", g.slug
        ORDER BY cnt DESC
        LIMIT 500
      `)
      if (facets.includes('groupId')) {
        const byGroup: Record<string, Array<{ tagId: string; tagSlug: string; tagName: string; groupId: string; count: number }>> = {}
        for (const r of rows) {
          (byGroup[r.groupSlug] ??= []).push({
            tagId: r.tagId, tagSlug: r.tagSlug, tagName: r.tagName,
            groupId: r.groupId, count: Number(r.cnt),
          })
        }
        facetData = { groupId: byGroup }
      }
    }

    return c.json({
      code: 0,
      data: {
        items: items.map(i => ({
          entityType:   i.entityType,
          entityId:     i.entityId,
          registeredAt: i.registeredAt.toISOString(),
          ...(include.includes('tags') ? { tags: tagsByEntity.get(i.entityId) ?? [] } : {}),
        })),
        total, page, pageSize,
        ...(facetData ? { facets: facetData } : {}),
      },
    }, 200)
  } catch (error: unknown) {
    logger.error({ err: error }, 'Search entities error')
    throw error
  }
})
