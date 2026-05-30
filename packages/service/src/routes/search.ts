/**
 * 多维检索
 *   POST /search/entities — BoolExpr DSL + 分页 + facet 聚合
 *   POST /search/pivot    — 二维标签透视（控制台 showcase）
 *
 * 详见 issue #17。
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { Prisma } from '@prisma/client'
import prisma from '../lib/db.js'
import logger from '../lib/logger.js'
import { requireRole } from '../middleware/auth.js'
import {
  SearchEntitiesBody, SearchEntitiesDataSchema,
  SearchPivotBody, SearchPivotDataSchema,
  SearchCooccurrenceBody, SearchCooccurrenceDataSchema,
  NlToDslBody, NlToDslData,
  ApiError, okData,
} from '../lib/schemas.js'
import { compileBoolExpr } from '../lib/search/compile.js'
import { loadActiveLlmConfig } from './llm-config.js'
import { buildProvider, LlmError } from '../lib/llm/index.js'
import { translateNlToDsl, validateBoolExpr } from '../lib/nl-to-dsl.js'

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
| \`{ "text": "<关键词>" }\` | metadata 的 name/description 全文命中 | 作用于实体本身，可与标签 leaf 组合 |
| \`{ "source": ["manual","ai",...] }\` | 至少有一条 EntityTag 来自指定 source | |
| \`{ "confidence": { "gte": 0.7, "lte": 1 } }\` | 至少一条 EntityTag 置信度落区间 | gte / lte 均可缺省 |
| \`{ "status": ["active","pending","rejected"] }\` | 状态在列表内 | 其他 leaf 默认 status=active |
| \`{ "and": [...] }\` / \`{ "or": [...] }\` / \`{ "not": <expr> }\` | 布尔组合 | 可嵌套任意深度 |

### 注意
- 每个 leaf 是独立 EXISTS 子查询，不要求"同一条 EntityTag 同时满足多个 leaf"。
  例：\`and: [{tag:"X"}, {source:["ai"]}]\` 表示"既被打过 X 标签，也存在至少一条 AI 来源标签"——可能不是同一条记录。
- \`tagSlug\` / \`tagAlias\` / \`descendantOf\` 解析后若得不到任何 tagId，正向 leaf 永远不命中；包在 \`not\` 中时永远命中。
- \`text\` leaf 不同于标签 leaf：它作用于**实体自身的 metadata**（name + description），不是 EXISTS 子查询。用 **ILIKE 子串匹配**（大小写不敏感），由 pg_trgm 索引加速；"鸡"可命中"宫保鸡丁"。与标签 leaf 组合即「标签过滤 + 关键词检索」。关键词里的 \`%\` / \`_\` 会被转义为字面量。
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

const exampleTextAndTag = {
  summary: '7.1 关键词 + 标签：川菜里名字/描述含"鸡"的菜',
  value: {
    entityType: 'dish',
    filter: {
      and: [
        { tagSlug: 'sichuan', groupSlug: 'cuisine' },
        { text: '鸡' },
      ],
    },
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
            textAndTag:      exampleTextAndTag,
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
    //    当存在 BoolExpr 过滤时，在事务内执行 SET LOCAL jit = off，
    //    避免 PG JIT 在结果集小、谓词复杂时产生 ~100-200ms 固定开销。
    type ItemRow = { entityType: string; entityId: string; registeredAt: Date }
    type CountRow = { count: bigint }

    const runQueries = async (db: Pick<typeof prisma, '$queryRaw'>) => Promise.all([
      db.$queryRaw<ItemRow[]>(Prisma.sql`
        SELECT re."entityType", re."entityId", re."registeredAt"
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
        ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      db.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
      `),
    ])

    const [items, countRows] = filter
      ? await prisma.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL jit = off`
          return runQueries(tx)
        })
      : await runQueries(prisma)
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

// ── POST /pivot ───────────────────────────────────────────────────────────────
const PIVOT_DESCRIPTION = `
二维标签透视：以两个 TagGroup 作为 X/Y 轴，每个 cell 为"同时持有该 row tag 和 col tag 的 active 实体数"。

### 用法
- \`rowGroupSlug\` / \`colGroupSlug\` 必须是不同的 group
- \`topN\` 限制每个维度只返回实体最多的前 N 个标签，避免巨表
- \`filter\` 可选，传 BoolExpr 限定子集（例如"只看 AI 标签 且 置信度 >= 0.7"的实体）

### 性能说明
- 三次 SQL：top-N rows / top-N cols / cells join
- cells 在 top-N × top-N 的笛卡尔积上聚合（topN=20 时 = 400 cells）
- 大数据集建议先用 filter 缩小到几千实体内

### 设计意图
让运营/管理员**一眼看到标签覆盖盲区**：例如"川菜 + 素食 = 3 条" 揭示新菜系覆盖不足。
`.trim()

const pivotExampleBasic = {
  summary: '1. 基础透视：菜系 × 膳食',
  value: { entityType: 'dish', rowGroupSlug: 'cuisine', colGroupSlug: 'dietary', topN: 20 },
}

const pivotExampleFiltered = {
  summary: '2. 限定 AI 高置信度的子集',
  value: {
    entityType: 'dish',
    rowGroupSlug: 'cuisine',
    colGroupSlug: 'dietary',
    topN: 10,
    filter: {
      and: [
        { source: ['ai'] },
        { confidence: { gte: 0.8 } },
      ],
    },
  },
}

const pivotResponseExample = {
  code: 0,
  data: {
    rows: [
      { tagId: 't_sichuan', slug: 'sichuan', name: '川菜', total: 87 },
      { tagId: 't_hunan',   slug: 'hunan',   name: '湘菜', total: 41 },
    ],
    cols: [
      { tagId: 't_vegan',  slug: 'vegan',  name: '素食', total: 13 },
      { tagId: 't_halal',  slug: 'halal',  name: '清真', total: 14 },
    ],
    cells: {
      't_sichuan:t_vegan': 3, 't_sichuan:t_halal': 8,
      't_hunan:t_vegan':   1, 't_hunan:t_halal':   4,
    },
    grandTotal: 151,
    uncategorized: { row: 12, col: 124 },
  },
}

const pivotRoute = createRoute({
  method: 'post', path: '/pivot',
  tags: ['检索'],
  summary: '二维标签透视（pivot）',
  description: PIVOT_DESCRIPTION,
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: SearchPivotBody,
          examples: {
            basic:    pivotExampleBasic,
            filtered: pivotExampleFiltered,
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
          schema: okData(SearchPivotDataSchema),
          examples: { success: { summary: '透视响应', value: pivotResponseExample } },
        },
      },
    },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
    404: { content: { 'application/json': { schema: ApiError } }, description: '分组不存在' },
  },
})

searchRouter.use('/pivot', requireRole('reader'))
searchRouter.openapi(pivotRoute, async (c) => {
  const { entityType, rowGroupSlug, colGroupSlug, filter, topN } = c.req.valid('json')

  if (rowGroupSlug === colGroupSlug) {
    return c.json({ code: 400, message: 'rowGroupSlug 与 colGroupSlug 必须不同' }, 400)
  }

  // 1) 解析 group slug → id
  const [rowGroup, colGroup] = await Promise.all([
    prisma.tagGroup.findFirst({ where: { slug: rowGroupSlug, deletedAt: null }, select: { id: true } }),
    prisma.tagGroup.findFirst({ where: { slug: colGroupSlug, deletedAt: null }, select: { id: true } }),
  ])
  if (!rowGroup) return c.json({ code: 404, message: `行维度分组「${rowGroupSlug}」不存在` }, 404)
  if (!colGroup) return c.json({ code: 404, message: `列维度分组「${colGroupSlug}」不存在` }, 404)

  try {
    // 2) 编译 filter（缺省=无过滤）
    const filterSql = filter
      ? Prisma.sql`AND ${await compileBoolExpr(filter)}`
      : Prisma.empty

    // 3) 在过滤子集上分别取 top-N 行/列 tag、grand total、uncategorized
    type AxisRow = { id: string; slug: string; name: string; total: bigint }
    type CountRow = { count: bigint }

    const axisTopNSql = (groupId: string) => Prisma.sql`
      SELECT t.id, t.slug, t.name, COUNT(DISTINCT et."entityId")::bigint AS total
      FROM "EntityTag" et
      JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
      JOIN "RegisteredEntity" re ON re."entityType" = et."entityType" AND re."entityId" = et."entityId"
      WHERE re."entityType" = ${entityType}
        AND et."status" = 'active'
        AND t."groupId" = ${groupId}
        ${filterSql}
      GROUP BY t.id, t.slug, t.name
      ORDER BY total DESC, t.name ASC
      LIMIT ${topN}
    `

    const [rowAxis, colAxis, grandRows, uncatRowRows, uncatColRows] = await Promise.all([
      prisma.$queryRaw<AxisRow[]>(axisTopNSql(rowGroup.id)),
      prisma.$queryRaw<AxisRow[]>(axisTopNSql(colGroup.id)),
      // grand total
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
      `),
      // uncategorized row: 该 entityType 实体子集中，没有 rowGroup 任何 active tag 的数量
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
          AND NOT EXISTS (
            SELECT 1 FROM "EntityTag" et
            JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
            WHERE et."entityType" = re."entityType"
              AND et."entityId"   = re."entityId"
              AND et."status" = 'active'
              AND t."groupId" = ${rowGroup.id}
          )
      `),
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
          AND NOT EXISTS (
            SELECT 1 FROM "EntityTag" et
            JOIN "Tag" t ON t.id = et."tagId" AND t."deletedAt" IS NULL
            WHERE et."entityType" = re."entityType"
              AND et."entityId"   = re."entityId"
              AND et."status" = 'active'
              AND t."groupId" = ${colGroup.id}
          )
      `),
    ])

    const rowTagIds = rowAxis.map(r => r.id)
    const colTagIds = colAxis.map(r => r.id)

    // 4) cells：在 top-N x top-N 上聚合
    type CellRow = { rowTagId: string; colTagId: string; cnt: bigint }
    const cellRows = rowTagIds.length > 0 && colTagIds.length > 0
      ? await prisma.$queryRaw<CellRow[]>(Prisma.sql`
          SELECT er."tagId" AS "rowTagId", ec."tagId" AS "colTagId",
                 COUNT(DISTINCT er."entityId")::bigint AS cnt
          FROM "EntityTag" er
          JOIN "EntityTag" ec ON ec."entityType" = er."entityType"
                              AND ec."entityId"   = er."entityId"
                              AND ec."status" = 'active'
          JOIN "RegisteredEntity" re ON re."entityType" = er."entityType"
                                     AND re."entityId"   = er."entityId"
          WHERE er."entityType" = ${entityType}
            AND er."status" = 'active'
            AND er."tagId" = ANY(${rowTagIds}::text[])
            AND ec."tagId" = ANY(${colTagIds}::text[])
            ${filterSql}
          GROUP BY er."tagId", ec."tagId"
        `)
      : []

    const cells: Record<string, number> = {}
    for (const r of cellRows) cells[`${r.rowTagId}:${r.colTagId}`] = Number(r.cnt)

    return c.json({
      code: 0,
      data: {
        rows: rowAxis.map(r => ({ tagId: r.id, slug: r.slug, name: r.name, total: Number(r.total) })),
        cols: colAxis.map(r => ({ tagId: r.id, slug: r.slug, name: r.name, total: Number(r.total) })),
        cells,
        grandTotal: Number(grandRows[0]?.count ?? 0),
        uncategorized: {
          row: Number(uncatRowRows[0]?.count ?? 0),
          col: Number(uncatColRows[0]?.count ?? 0),
        },
      },
    }, 200)
  } catch (error: unknown) {
    logger.error({ err: error }, 'Search pivot error')
    throw error
  }
})

// ── POST /nl-to-dsl ───────────────────────────────────────────────────────────
const NL_DESCRIPTION = `
把中文自然语言查询翻译为 BoolExpr。

### 用法
- \`text\`：自然语言输入（例：「川菜餐厅但不要素食的，AI 高置信度」）
- \`entityType\`：可选实体类型，提供给 LLM 作为上下文，提升翻译准确率

### 行为
- 使用系统设置中配置的 LLM provider（Anthropic / OpenAI）
- LLM 强制结构化输出 BoolExpr JSON
- 服务端做二次 Zod 校验；不合法时返回 \`boolExpr=null\` + 错误说明

### 配置缺失
若管理员未在 \`/settings/llm\` 配置 provider/apiKey，或 enabled=false，返回 400。
`.trim()

const nlExample = {
  summary: '川菜或湘菜，不要素食，AI 高置信度',
  value: {
    text: '川菜或湘菜的菜，但不要素食，要 AI 高置信度的',
    entityType: 'dish',
  },
}

const nlToDslRoute = createRoute({
  method: 'post', path: '/nl-to-dsl',
  tags: ['检索'],
  summary: '自然语言 → BoolExpr 翻译',
  description: NL_DESCRIPTION,
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: NlToDslBody,
          examples: { basic: nlExample },
        },
      },
    },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(NlToDslData) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误 / LLM 未配置' },
    502: { content: { 'application/json': { schema: ApiError } }, description: 'LLM 调用失败' },
  },
})

searchRouter.use('/nl-to-dsl', requireRole('reader'))
searchRouter.openapi(nlToDslRoute, async (c) => {
  const body = c.req.valid('json')

  const cfg = await loadActiveLlmConfig()
  if (!cfg) {
    return c.json({
      code: 400,
      message: 'LLM 未配置或未启用。请管理员前往 /settings/llm 配置 provider 和 API key。',
    }, 400)
  }

  let provider
  try {
    provider = buildProvider(cfg)
  } catch (e) {
    return c.json({ code: 400, message: `LLM provider 初始化失败：${(e as Error).message}` }, 400)
  }

  try {
    const translated = await translateNlToDsl(provider, body)
    const validated  = validateBoolExpr(translated.boolExpr)

    logger.info({
      input:    body.text,
      model:    translated.model,
      hasExpr:  validated !== null,
    }, 'NL→DSL translation')

    const explanation = validated || translated.boolExpr === null || translated.boolExpr === undefined
      ? translated.explanation
      : `${translated.explanation}\n\n（注意：LLM 返回的结构未通过 schema 校验，已置为空）`
    return c.json({
      code: 0,
      data: {
        boolExpr:    validated ?? undefined,
        explanation,
        model:       translated.model,
      },
    }, 200)
  } catch (e) {
    if (e instanceof LlmError) {
      logger.warn({ err: e }, 'NL→DSL LLM error')
      return c.json({ code: 502, message: e.message }, 502)
    }
    logger.error({ err: e }, 'NL→DSL unexpected error')
    throw e
  }
})

// ── POST /co-occurrence ───────────────────────────────────────────────────────
const COOCCUR_DESCRIPTION = `
计算标签共现矩阵 — 在给定子集中，哪些标签倾向于同时出现。

### 用法
- \`entityType\`：实体类型
- \`filter\`：可选 BoolExpr，限定子集（例如"只看 AI 高置信度的"）
- \`topN\`：取使用量最大的 N 个标签（控制 N×N 矩阵规模）

### 输出
- \`tags\`：参与矩阵的标签数组（含 total 实体数）
- \`cooccurrence\`：对称矩阵稀疏存储，key = \`<tagAId>:<tagBId>\`（字典序），
  value = \`{ count, lift }\`
- \`totalEntities\`：用于 lift 计算的分母

### lift 含义
- \`lift = (共现数 × 总实体数) / (tagA 总数 × tagB 总数)\`
- > 1：两个标签正相关（同现概率高于随机）
- = 1：独立
- < 1：负相关

### 设计意图
让运营发现"哪些标签经常一起用"——可能提示标签冗余、潜在合并机会、或某种内在关联。
`.trim()

const cooccurExample = {
  summary: '基础查询：dish 实体的共现',
  value: { entityType: 'dish', topN: 15 },
}

const cooccurRoute = createRoute({
  method: 'post', path: '/co-occurrence',
  tags: ['检索'],
  summary: '标签共现矩阵',
  description: COOCCUR_DESCRIPTION,
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SearchCooccurrenceBody, examples: { basic: cooccurExample } } },
    },
  },
  responses: {
    200: { content: { 'application/json': { schema: okData(SearchCooccurrenceDataSchema) } }, description: '成功' },
    400: { content: { 'application/json': { schema: ApiError } }, description: '参数错误' },
  },
})

searchRouter.use('/co-occurrence', requireRole('reader'))
searchRouter.openapi(cooccurRoute, async (c) => {
  const { entityType, filter, topN } = c.req.valid('json')

  try {
    const filterSql = filter
      ? Prisma.sql`AND ${await compileBoolExpr(filter)}`
      : Prisma.empty

    type TagRow = {
      id: string; slug: string; name: string
      groupSlug: string; groupName: string
      total: bigint
    }
    type CountRow = { count: bigint }

    // top-N tags + 子集总实体数 并行查
    const [tagRows, totalRows] = await Promise.all([
      prisma.$queryRaw<TagRow[]>(Prisma.sql`
        SELECT t.id, t.slug, t.name,
               g.slug AS "groupSlug", g.name AS "groupName",
               COUNT(DISTINCT et."entityId")::bigint AS total
        FROM "EntityTag" et
        JOIN "Tag" t       ON t.id = et."tagId" AND t."deletedAt" IS NULL
        JOIN "TagGroup" g  ON g.id = t."groupId" AND g."deletedAt" IS NULL
        JOIN "RegisteredEntity" re ON re."entityType" = et."entityType" AND re."entityId" = et."entityId"
        WHERE re."entityType" = ${entityType}
          AND et."status" = 'active'
          ${filterSql}
        GROUP BY t.id, t.slug, t.name, g.slug, g.name
        ORDER BY total DESC, t.name ASC
        LIMIT ${topN}
      `),
      prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "RegisteredEntity" re
        WHERE re."entityType" = ${entityType}
          ${filterSql}
      `),
    ])

    const totalEntities = Number(totalRows[0]?.count ?? 0)
    const tagIds = tagRows.map(r => r.id)
    const tagTotals: Record<string, number> = {}
    for (const r of tagRows) tagTotals[r.id] = Number(r.total)

    type PairRow = { tagA: string; tagB: string; cnt: bigint }
    const pairs = tagIds.length > 1 && totalEntities > 0
      ? await prisma.$queryRaw<PairRow[]>(Prisma.sql`
          SELECT LEAST(er."tagId", ec."tagId") AS "tagA",
                 GREATEST(er."tagId", ec."tagId") AS "tagB",
                 COUNT(DISTINCT er."entityId")::bigint AS cnt
          FROM "EntityTag" er
          JOIN "EntityTag" ec ON ec."entityType" = er."entityType"
                              AND ec."entityId"   = er."entityId"
                              AND ec."status" = 'active'
                              AND ec."tagId" > er."tagId"
          JOIN "RegisteredEntity" re ON re."entityType" = er."entityType"
                                     AND re."entityId"   = er."entityId"
          WHERE er."entityType" = ${entityType}
            AND er."status" = 'active'
            AND er."tagId" = ANY(${tagIds}::text[])
            AND ec."tagId" = ANY(${tagIds}::text[])
            ${filterSql}
          GROUP BY LEAST(er."tagId", ec."tagId"), GREATEST(er."tagId", ec."tagId")
        `)
      : []

    const cooccurrence: Record<string, { count: number; lift: number }> = {}
    for (const p of pairs) {
      const count = Number(p.cnt)
      const tA = tagTotals[p.tagA] || 0
      const tB = tagTotals[p.tagB] || 0
      const expected = (tA * tB) / totalEntities
      const lift = expected > 0 ? count / expected : 0
      cooccurrence[`${p.tagA}:${p.tagB}`] = { count, lift: parseFloat(lift.toFixed(3)) }
    }

    return c.json({
      code: 0,
      data: {
        tags: tagRows.map(r => ({
          tagId: r.id, slug: r.slug, name: r.name,
          groupSlug: r.groupSlug, groupName: r.groupName,
          total: Number(r.total),
        })),
        cooccurrence,
        totalEntities,
      },
    }, 200)
  } catch (error: unknown) {
    logger.error({ err: error }, 'Search co-occurrence error')
    throw error
  }
})
