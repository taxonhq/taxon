/**
 * BoolExpr → Prisma SQL 编译器
 *
 * 设计要点：
 * - 主查询的外层 alias 固定为 `re`（RegisteredEntity）。每个 leaf 编译为
 *   `EXISTS (SELECT 1 FROM "EntityTag" et WHERE et."entityType"=re."entityType"
 *   AND et."entityId"=re."entityId" AND <leaf condition>)`，组合自然支持 AND/OR/NOT。
 * - tag/tagSlug/tagAlias/descendantOf 默认要求 `et."status"='active'`，
 *   `{ status: [...] }` leaf 单独检查（不影响其他 leaf 的默认）。
 * - tagSlug/tagAlias/descendantOf 需要先解析为具体 tagId 集合（避免 leaf 内嵌子查询带来的性能不可预测性）。
 *   解析在编译入口一次性完成。
 * - 任一 leaf 解析为空 tagId 集时：
 *     - 正向 leaf 编译为 `FALSE`（永不满足）
 *     - 在 NOT 中变为 `TRUE`（永远满足）
 *   这是 BoolExpr 语义的自然结果。
 */
import { Prisma } from '@prisma/client'
import prisma from '../db.js'
import type { BoolExpr } from '../schemas.js'

// ── 预解析：收集所有需要查询的 slug / alias / descendantOf 引用 ───────────────
type RefSet = {
  tagSlugs:     Array<{ slug: string; groupSlug?: string }>
  tagAliases:   Array<{ alias: string; groupSlug?: string }>
  descendantOf: string[]
}

function collectRefs(expr: BoolExpr, refs: RefSet): void {
  if ('and' in expr) { expr.and.forEach(e => collectRefs(e, refs)); return }
  if ('or'  in expr) { expr.or .forEach(e => collectRefs(e, refs)); return }
  if ('not' in expr) { collectRefs(expr.not, refs); return }
  if ('tagSlug'      in expr) { refs.tagSlugs.push({ slug: expr.tagSlug, groupSlug: expr.groupSlug }); return }
  if ('tagAlias'     in expr) { refs.tagAliases.push({ alias: expr.tagAlias, groupSlug: expr.groupSlug }); return }
  if ('descendantOf' in expr) { refs.descendantOf.push(expr.descendantOf); return }
}

type Resolved = {
  // key: `${slug}|${groupSlug ?? ''}` → tagId[]
  slugMap:    Map<string, string[]>
  aliasMap:   Map<string, string[]>
  // key: descendantOf tagId → descendant tagId[]（含自身）
  descMap:    Map<string, string[]>
}

const slugKey  = (s: string, g?: string) => `${s}|${g ?? ''}`
const aliasKey = (a: string, g?: string) => `${a}|${g ?? ''}`

async function resolveRefs(refs: RefSet): Promise<Resolved> {
  const slugMap  = new Map<string, string[]>()
  const aliasMap = new Map<string, string[]>()
  const descMap  = new Map<string, string[]>()

  // 1) tagSlug 解析（同 slug 可能在多个 group 下存在，需用 groupSlug 区分；不指定时全部命中）
  if (refs.tagSlugs.length > 0) {
    const uniqSlugs = [...new Set(refs.tagSlugs.map(r => r.slug))]
    const rows = await prisma.tag.findMany({
      where: { slug: { in: uniqSlugs }, deletedAt: null },
      select: { id: true, slug: true, group: { select: { slug: true } } },
    })
    for (const ref of refs.tagSlugs) {
      const key = slugKey(ref.slug, ref.groupSlug)
      if (slugMap.has(key)) continue
      const matched = rows
        .filter(r => r.slug === ref.slug && (!ref.groupSlug || r.group.slug === ref.groupSlug))
        .map(r => r.id)
      slugMap.set(key, matched)
    }
  }

  // 2) tagAlias 解析
  if (refs.tagAliases.length > 0) {
    const uniqAliases = [...new Set(refs.tagAliases.map(r => r.alias))]
    const rows = await prisma.tagAlias.findMany({
      where: { alias: { in: uniqAliases }, tag: { deletedAt: null } },
      select: { tagId: true, alias: true, tag: { select: { group: { select: { slug: true } } } } },
    })
    for (const ref of refs.tagAliases) {
      const key = aliasKey(ref.alias, ref.groupSlug)
      if (aliasMap.has(key)) continue
      const matched = rows
        .filter(r => r.alias === ref.alias && (!ref.groupSlug || r.tag.group.slug === ref.groupSlug))
        .map(r => r.tagId)
      aliasMap.set(key, matched)
    }
  }

  // 3) descendantOf 解析：用 path 前缀匹配该 tag 及其所有子孙
  if (refs.descendantOf.length > 0) {
    const uniqIds = [...new Set(refs.descendantOf)]
    const roots = await prisma.tag.findMany({
      where: { id: { in: uniqIds }, deletedAt: null },
      select: { id: true, path: true, groupId: true },
    })
    for (const root of roots) {
      // path 仅组内唯一，子树必须限定同 groupId，避免跨分组同前缀污染（#146）
      const subtree = await prisma.tag.findMany({
        where: { groupId: root.groupId, path: { startsWith: root.path }, deletedAt: null },
        select: { id: true },
      })
      descMap.set(root.id, subtree.map(t => t.id))
    }
    // 未找到的 root 留空数组
    for (const id of uniqIds) if (!descMap.has(id)) descMap.set(id, [])
  }

  return { slugMap, aliasMap, descMap }
}

// ── SQL 片段生成 ──────────────────────────────────────────────────────────────
const FALSE = Prisma.sql`FALSE`
const TRUE  = Prisma.sql`TRUE`

function existsByTagIds(tagIds: string[]): Prisma.Sql {
  if (tagIds.length === 0) return FALSE
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "EntityTag" et
    WHERE et."entityType" = re."entityType"
      AND et."entityId"   = re."entityId"
      AND et."tagId" = ANY(${tagIds}::text[])
      AND et."status" = 'active'
  )`
}

function compileLeaf(expr: BoolExpr, resolved: Resolved): Prisma.Sql {
  if ('tag' in expr) return existsByTagIds([expr.tag])

  if ('tagSlug' in expr) {
    const ids = resolved.slugMap.get(slugKey(expr.tagSlug, expr.groupSlug)) ?? []
    return existsByTagIds(ids)
  }
  if ('tagAlias' in expr) {
    const ids = resolved.aliasMap.get(aliasKey(expr.tagAlias, expr.groupSlug)) ?? []
    return existsByTagIds(ids)
  }
  if ('descendantOf' in expr) {
    const ids = resolved.descMap.get(expr.descendantOf) ?? []
    return existsByTagIds(ids)
  }

  if ('text' in expr) {
    // 关键词【子串】检索：作用于 RegisteredEntity.metadata（name + description）。
    // 与标签 leaf 不同，metadata 在主表 re 上，直接产生条件、不包 EXISTS 子查询。
    //
    // 用 ILIKE '%kw%' 子串匹配，由 pg_trgm 的 gin_trgm_ops 索引加速。
    // 为什么【不】用 to_tsvector 全文检索：'simple' 配置不对中文分词，整段 CJK
    //   会被当作单个 token（'宫保鸡丁' 是一个词），而 FTS 匹配整词、非子串，
    //   于是 '鸡' 命中不了 '宫保鸡丁'。子串语义才是"名字/描述含关键词"的真实需求。
    // ⚠ 拼接表达式必须与 migration 20260530000000_metadata_trgm_search 的
    //   gin_trgm_ops 索引表达式逐字一致，否则无法命中索引。
    //
    // 转义 LIKE 元字符（\ % _），避免关键词里的 % / _ 被当通配符（默认转义符为 \）。
    const escaped = expr.text.replace(/[\\%_]/g, '\\$&')
    const pattern = `%${escaped}%`
    return Prisma.sql`(
        COALESCE(re."metadata"->>'name', '') || ' ' || COALESCE(re."metadata"->>'description', '')
      ) ILIKE ${pattern}`
  }

  if ('source' in expr) {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "EntityTag" et
      WHERE et."entityType" = re."entityType"
        AND et."entityId"   = re."entityId"
        AND et."source"::text = ANY(${expr.source}::text[])
        AND et."status" = 'active'
    )`
  }

  if ('confidence' in expr) {
    const c = expr.confidence
    const gteClause = c.gte !== undefined ? Prisma.sql`AND et."confidence" >= ${c.gte}` : Prisma.empty
    const lteClause = c.lte !== undefined ? Prisma.sql`AND et."confidence" <= ${c.lte}` : Prisma.empty
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "EntityTag" et
      WHERE et."entityType" = re."entityType"
        AND et."entityId"   = re."entityId"
        ${gteClause}
        ${lteClause}
        AND et."status" = 'active'
    )`
  }

  if ('status' in expr) {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "EntityTag" et
      WHERE et."entityType" = re."entityType"
        AND et."entityId"   = re."entityId"
        AND et."status"::text = ANY(${expr.status}::text[])
    )`
  }

  // 应该已被 compile() 上层处理
  return TRUE
}

// ── OR 合并优化 ───────────────────────────────────────────────────────────────
// 当 or 的所有子节点都能解析为 tagId 集合时，合并成单个 existsByTagIds(ANY)。
// 这样 PG 走单次 EntityTag_tagId_status_idx bitmap scan，而不是 N 个独立 EXISTS subplan。
//
// "可合并 leaf" = tag / tagSlug / tagAlias / descendantOf（均在 resolveRefs 阶段预解析）
// source / confidence / status / and / or / not 不参与合并
function leafTagIds(expr: BoolExpr, resolved: Resolved): string[] | null {
  if ('tag'          in expr) return [expr.tag]
  if ('tagSlug'      in expr) return resolved.slugMap.get(slugKey(expr.tagSlug, expr.groupSlug)) ?? null
  if ('tagAlias'     in expr) return resolved.aliasMap.get(aliasKey(expr.tagAlias, expr.groupSlug)) ?? null
  if ('descendantOf' in expr) return resolved.descMap.get(expr.descendantOf) ?? null
  return null
}

export function compileExpr(expr: BoolExpr, resolved: Resolved): Prisma.Sql {
  if ('and' in expr) {
    if (expr.and.length === 1) return compileExpr(expr.and[0], resolved)
    const parts = expr.and.map(e => compileExpr(e, resolved))
    return Prisma.sql`(${Prisma.join(parts, ' AND ')})`
  }
  if ('or' in expr) {
    if (expr.or.length === 1) return compileExpr(expr.or[0], resolved)

    // OR-merge 优化：全同形 tag leaf → 单个 existsByTagIds(ANY)
    const merged: string[] = []
    let canMerge = true
    for (const child of expr.or) {
      const ids = leafTagIds(child, resolved)
      if (ids === null) { canMerge = false; break }
      merged.push(...ids)
    }
    if (canMerge) return existsByTagIds([...new Set(merged)])

    const parts = expr.or.map(e => compileExpr(e, resolved))
    return Prisma.sql`(${Prisma.join(parts, ' OR ')})`
  }
  if ('not' in expr) {
    return Prisma.sql`(NOT ${compileExpr(expr.not, resolved)})`
  }
  return compileLeaf(expr, resolved)
}

export async function compileBoolExpr(expr: BoolExpr): Promise<Prisma.Sql> {
  const refs: RefSet = { tagSlugs: [], tagAliases: [], descendantOf: [] }
  collectRefs(expr, refs)
  const resolved = await resolveRefs(refs)
  return compileExpr(expr, resolved)
}
