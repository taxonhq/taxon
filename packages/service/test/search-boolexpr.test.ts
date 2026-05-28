/**
 * BoolExpr → SQL 编译器单测（issue #43）
 *
 * 策略：
 *   - 大多数 case 直接调 compileBoolExpr，把它的 SQL 片段嵌入
 *     `SELECT re."entityId" FROM "RegisteredEntity" re WHERE re."entityType"=? AND <filter>`
 *     执行，断言命中的 entityId 集合。这能直接覆盖编译器的所有分支
 *     而不掺杂分页/排序/facets 等路由逻辑。
 *   - Zod 拒绝、HTTP 响应 shape 单独走 buildApp + fetch 触达 POST /search/entities。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Prisma, TagSource, TagStatus } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
import { buildApp } from '../src/app.js'
import { compileBoolExpr } from '../src/lib/search/compile.js'
import type { BoolExpr } from '../src/lib/schemas.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

// ── 共用工具 ──────────────────────────────────────────────────────────────

/** 执行编译后的 SQL，返回命中的 entityId 集合（排序后便于 toEqual 比较）。 */
async function runFilter(entityType: string, expr: BoolExpr): Promise<string[]> {
  const filterSql = await compileBoolExpr(expr)
  const rows = await prisma.$queryRaw<Array<{ entityId: string }>>(Prisma.sql`
    SELECT re."entityId"
    FROM "RegisteredEntity" re
    WHERE re."entityType" = ${entityType} AND ${filterSql}
    ORDER BY re."entityId"
  `)
  return rows.map(r => r.entityId).sort()
}

async function makeTagWithPath(args: { groupId: string; slug: string; parentPath?: string }) {
  const path = `${args.parentPath ?? ''}${args.slug}/`
  return prisma.tag.create({
    data: {
      groupId: args.groupId,
      slug:    args.slug,
      name:    args.slug,
      path,
      depth:   path.split('/').filter(Boolean).length - 1,
    },
  })
}

async function makeAlias(tagId: string, alias: string) {
  return prisma.tagAlias.create({ data: { tagId, alias } })
}

// ── A. leaf 命中/未命中 ──────────────────────────────────────────────────

describe('compileBoolExpr — leaf: tag', () => {
  it('命中持有该 tagId 的实体', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const e1 = await makeEntity('dish')
    const e2 = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: e1.entityId })
    await makeEntity('dish') // 未打标的实体不该命中

    expect(await runFilter('dish', { tag: t.id })).toEqual([e1.entityId])
    expect(await runFilter('dish', { tag: t.id })).not.toContain(e2.entityId)
  })

  it('不存在的 tagId 返回空集，不抛 500', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { tag: 'no-such-tag' })).toEqual([])
  })

  it('仅 status=active 的 EntityTag 命中（默认 status 过滤）', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eActive  = await makeEntity('dish')
    const ePending = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eActive.entityId,  status: TagStatus.active })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: ePending.entityId, status: TagStatus.pending })

    expect(await runFilter('dish', { tag: t.id })).toEqual([eActive.entityId])
  })
})

describe('compileBoolExpr — leaf: tagSlug', () => {
  it('指定 groupSlug 时精确匹配同 group 的 tag', async () => {
    const cuisine = await makeGroup({ slug: 'cuisine' })
    const region  = await makeGroup({ slug: 'region' })
    const tCuisineSichuan = await makeTag({ groupId: cuisine.id, slug: 'sichuan' })
    const tRegionSichuan  = await makeTag({ groupId: region.id,  slug: 'sichuan' })  // 同 slug，不同 group
    const e1 = await makeEntity('dish')
    const e2 = await makeEntity('dish')
    await attachTag({ tagId: tCuisineSichuan.id, entityType: 'dish', entityId: e1.entityId })
    await attachTag({ tagId: tRegionSichuan.id,  entityType: 'dish', entityId: e2.entityId })

    expect(await runFilter('dish', { tagSlug: 'sichuan', groupSlug: 'cuisine' })).toEqual([e1.entityId])
  })

  it('未指定 groupSlug 时跨 group 全部命中', async () => {
    const cuisine = await makeGroup({ slug: 'cuisine' })
    const region  = await makeGroup({ slug: 'region' })
    const t1 = await makeTag({ groupId: cuisine.id, slug: 'sichuan' })
    const t2 = await makeTag({ groupId: region.id,  slug: 'sichuan' })
    const e1 = await makeEntity('dish')
    const e2 = await makeEntity('dish')
    await attachTag({ tagId: t1.id, entityType: 'dish', entityId: e1.entityId })
    await attachTag({ tagId: t2.id, entityType: 'dish', entityId: e2.entityId })

    expect(await runFilter('dish', { tagSlug: 'sichuan' })).toEqual([e1.entityId, e2.entityId].sort())
  })

  it('不存在的 slug 返回空集', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { tagSlug: 'no-such-slug' })).toEqual([])
  })

  it('软删除的 tag 不命中', async () => {
    const g = await makeGroup({ slug: 'cuisine' })
    const t = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const e = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: e.entityId })
    await prisma.tag.update({ where: { id: t.id }, data: { deletedAt: new Date() } })

    expect(await runFilter('dish', { tagSlug: 'sichuan' })).toEqual([])
  })
})

describe('compileBoolExpr — leaf: tagAlias', () => {
  it('alias 命中对应 tag 的实体', async () => {
    const g = await makeGroup({ slug: 'cuisine' })
    const t = await makeTag({ groupId: g.id, slug: 'sichuan' })
    await makeAlias(t.id, '麻辣')
    const e = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: e.entityId })

    expect(await runFilter('dish', { tagAlias: '麻辣' })).toEqual([e.entityId])
  })

  it('指定 groupSlug 时限制 alias 解析范围', async () => {
    const cuisine = await makeGroup({ slug: 'cuisine' })
    const dietary = await makeGroup({ slug: 'dietary' })
    const tCuisine = await makeTag({ groupId: cuisine.id, slug: 'sichuan' })
    const tDietary = await makeTag({ groupId: dietary.id, slug: 'spicy' })
    await makeAlias(tCuisine.id, '辣')
    await makeAlias(tDietary.id, '辣')
    const eC = await makeEntity('dish')
    const eD = await makeEntity('dish')
    await attachTag({ tagId: tCuisine.id, entityType: 'dish', entityId: eC.entityId })
    await attachTag({ tagId: tDietary.id, entityType: 'dish', entityId: eD.entityId })

    expect(await runFilter('dish', { tagAlias: '辣', groupSlug: 'cuisine' })).toEqual([eC.entityId])
  })

  it('不存在的 alias 返回空集', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { tagAlias: '不存在的别名' })).toEqual([])
  })
})

describe('compileBoolExpr — leaf: descendantOf', () => {
  it('命中自身 + 子孙节点所打过标签的实体', async () => {
    const g       = await makeGroup({ slug: 'cuisine' })
    const root    = await makeTagWithPath({ groupId: g.id, slug: 'chinese' })
    const child   = await makeTagWithPath({ groupId: g.id, slug: 'sichuan', parentPath: root.path })
    const gchild  = await makeTagWithPath({ groupId: g.id, slug: 'chengdu', parentPath: child.path })
    const sibling = await makeTagWithPath({ groupId: g.id, slug: 'italian' }) // 不同子树

    const eRoot    = await makeEntity('dish')
    const eChild   = await makeEntity('dish')
    const eGchild  = await makeEntity('dish')
    const eSibling = await makeEntity('dish')
    await attachTag({ tagId: root.id,    entityType: 'dish', entityId: eRoot.entityId })
    await attachTag({ tagId: child.id,   entityType: 'dish', entityId: eChild.entityId })
    await attachTag({ tagId: gchild.id,  entityType: 'dish', entityId: eGchild.entityId })
    await attachTag({ tagId: sibling.id, entityType: 'dish', entityId: eSibling.entityId })

    const hit = await runFilter('dish', { descendantOf: root.id })
    expect(hit).toEqual([eRoot.entityId, eChild.entityId, eGchild.entityId].sort())
    expect(hit).not.toContain(eSibling.entityId)
  })

  it('不存在的根 tagId 返回空集', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { descendantOf: 'no-such-root' })).toEqual([])
  })
})

describe('compileBoolExpr — leaf: source', () => {
  it('单值 source 命中', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eAi     = await makeEntity('dish')
    const eManual = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eAi.entityId,     source: TagSource.ai })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eManual.entityId, source: TagSource.manual })

    expect(await runFilter('dish', { source: ['ai'] })).toEqual([eAi.entityId])
  })

  it('多值 source 命中并集', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eAi     = await makeEntity('dish')
    const eImport = await makeEntity('dish')
    const eManual = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eAi.entityId,     source: TagSource.ai })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eImport.entityId, source: TagSource.import })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eManual.entityId, source: TagSource.manual })

    expect(await runFilter('dish', { source: ['ai', 'import'] })).toEqual([eAi.entityId, eImport.entityId].sort())
  })
})

describe('compileBoolExpr — leaf: confidence', () => {
  it('仅 gte 过滤', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eHi = await makeEntity('dish')
    const eLo = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eHi.entityId, source: TagSource.ai, confidence: 0.9 })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eLo.entityId, source: TagSource.ai, confidence: 0.3 })

    expect(await runFilter('dish', { confidence: { gte: 0.7 } })).toEqual([eHi.entityId])
  })

  it('仅 lte 过滤', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eHi = await makeEntity('dish')
    const eLo = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eHi.entityId, source: TagSource.ai, confidence: 0.9 })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eLo.entityId, source: TagSource.ai, confidence: 0.3 })

    expect(await runFilter('dish', { confidence: { lte: 0.5 } })).toEqual([eLo.entityId])
  })

  it('gte + lte 区间', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eMid = await makeEntity('dish')
    const eHi  = await makeEntity('dish')
    const eLo  = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eMid.entityId, source: TagSource.ai, confidence: 0.6 })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eHi.entityId,  source: TagSource.ai, confidence: 0.95 })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eLo.entityId,  source: TagSource.ai, confidence: 0.2 })

    expect(await runFilter('dish', { confidence: { gte: 0.5, lte: 0.8 } })).toEqual([eMid.entityId])
  })

  it('gte/lte 都缺省时只剩"存在 active EntityTag"约束，命中所有打过标的实体', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eTagged    = await makeEntity('dish')
    const eUntagged  = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eTagged.entityId, source: TagSource.manual })

    const hit = await runFilter('dish', { confidence: {} })
    expect(hit).toEqual([eTagged.entityId])
    expect(hit).not.toContain(eUntagged.entityId)
  })
})

describe('compileBoolExpr — leaf: status', () => {
  it('单值 status 命中', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eA = await makeEntity('dish')
    const eP = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eA.entityId, status: TagStatus.active })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eP.entityId, status: TagStatus.pending })

    expect(await runFilter('dish', { status: ['pending'] })).toEqual([eP.entityId])
  })

  it('多值 status 命中并集', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eA = await makeEntity('dish')
    const eP = await makeEntity('dish')
    const eR = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eA.entityId, status: TagStatus.active })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eP.entityId, status: TagStatus.pending })
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eR.entityId, status: TagStatus.rejected })

    expect(await runFilter('dish', { status: ['pending', 'rejected'] })).toEqual([eP.entityId, eR.entityId].sort())
  })
})

// ── B. 空 tagId 解析的 NOT 语义 ─────────────────────────────────────────

describe('compileBoolExpr — 空 tagId 解析', () => {
  it('正向 leaf 在 tagSlug 解析为空时永远不命中 (FALSE)', async () => {
    await makeEntity('dish')
    await makeEntity('dish')
    expect(await runFilter('dish', { tagSlug: 'no-such-slug' })).toEqual([])
  })

  it('NOT 包裹空解析时变为 TRUE（命中全部已注册实体）', async () => {
    const e1 = await makeEntity('dish')
    const e2 = await makeEntity('dish')
    const e3 = await makeEntity('other') // 不同 entityType 不应混入
    void e3

    const hit = await runFilter('dish', { not: { tagSlug: 'no-such-slug' } })
    expect(hit).toEqual([e1.entityId, e2.entityId].sort())
  })
})

// ── C. AND / OR / NOT 组合 ──────────────────────────────────────────────

describe('compileBoolExpr — 组合', () => {
  async function setupTwoTags() {
    const g = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const tB = await makeTag({ groupId: g.id, slug: 'hunan' })
    const eA  = await makeEntity('dish')
    const eB  = await makeEntity('dish')
    const eAB = await makeEntity('dish')
    const eNone = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eA.entityId })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: eB.entityId })
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eAB.entityId })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: eAB.entityId })
    return { tA, tB, eA, eB, eAB, eNone }
  }

  it('AND：同时持有 A 和 B', async () => {
    const { tA, tB, eAB } = await setupTwoTags()
    expect(await runFilter('dish', { and: [{ tag: tA.id }, { tag: tB.id }] })).toEqual([eAB.entityId])
  })

  it('OR：持有 A 或 B', async () => {
    const { tA, tB, eA, eB, eAB } = await setupTwoTags()
    expect(await runFilter('dish', { or: [{ tag: tA.id }, { tag: tB.id }] })).toEqual([eA.entityId, eB.entityId, eAB.entityId].sort())
  })

  it('NOT：未持有 A', async () => {
    const { tA, eB, eNone } = await setupTwoTags()
    expect(await runFilter('dish', { not: { tag: tA.id } })).toEqual([eB.entityId, eNone.entityId].sort())
  })

  it('单元素 AND 等价于直接 leaf', async () => {
    const { tA, eA, eAB } = await setupTwoTags()
    expect(await runFilter('dish', { and: [{ tag: tA.id }] })).toEqual([eA.entityId, eAB.entityId].sort())
  })

  it('单元素 OR 等价于直接 leaf', async () => {
    const { tA, eA, eAB } = await setupTwoTags()
    expect(await runFilter('dish', { or: [{ tag: tA.id }] })).toEqual([eA.entityId, eAB.entityId].sort())
  })

  it('三层嵌套：(A OR B) AND NOT C AND confidence>=0.7', async () => {
    const g = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const tB = await makeTag({ groupId: g.id, slug: 'hunan' })
    const tC = await makeTag({ groupId: g.id, slug: 'vegan' })

    const hit       = await makeEntity('dish') // A + AI conf 0.9
    const skipNoTag = await makeEntity('dish') // 啥都没打
    const skipVegan = await makeEntity('dish') // A + vegan
    const skipLowConf = await makeEntity('dish') // A + AI conf 0.3
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: hit.entityId, source: TagSource.ai, confidence: 0.9 })
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: skipVegan.entityId })
    await attachTag({ tagId: tC.id, entityType: 'dish', entityId: skipVegan.entityId })
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: skipLowConf.entityId, source: TagSource.ai, confidence: 0.3 })
    void skipNoTag

    const expr: BoolExpr = {
      and: [
        { or:  [{ tag: tA.id }, { tag: tB.id }] },
        { not: { tag: tC.id } },
        { confidence: { gte: 0.7 } },
      ],
    }
    expect(await runFilter('dish', expr)).toEqual([hit.entityId])
  })

  it('depth=10 嵌套不爆栈', async () => {
    const g = await makeGroup({ slug: 'cuisine' })
    const t = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const e = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: e.entityId })

    let expr: BoolExpr = { tag: t.id }
    for (let i = 0; i < 10; i++) expr = { and: [expr] }
    expect(await runFilter('dish', expr)).toEqual([e.entityId])
  })

  it('多 leaf AND 不要求同一条 EntityTag 同时满足', async () => {
    // 文档里强调："and: [{tag:X}, {source:[ai]}] 表示既被打过 X 也存在 AI 来源"
    // 不要求是同一条 record
    const g = await makeGroup({ slug: 'cuisine' })
    const t1 = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const t2 = await makeTag({ groupId: g.id, slug: 'hunan' })
    const e = await makeEntity('dish')
    // sichuan 来自 manual；hunan 来自 ai —— 两条不同 record 但同实体
    await attachTag({ tagId: t1.id, entityType: 'dish', entityId: e.entityId, source: TagSource.manual })
    await attachTag({ tagId: t2.id, entityType: 'dish', entityId: e.entityId, source: TagSource.ai, confidence: 0.9 })

    expect(await runFilter('dish', { and: [{ tag: t1.id }, { source: ['ai'] }] })).toEqual([e.entityId])
  })
})

// ── D. Zod 拒绝（直接调 schema 验证，不需要起 HTTP） ──────────────────────

describe('BoolExpr Zod schema 拒绝', () => {
  it('空 and 数组', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ and: [] }).success).toBe(false)
  })

  it('空 or 数组', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ or: [] }).success).toBe(false)
  })

  it('空 source 数组', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ source: [] }).success).toBe(false)
  })

  it('空 status 数组', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ status: [] }).success).toBe(false)
  })

  it('未知 source 值', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ source: ['bogus'] }).success).toBe(false)
  })

  it('confidence 越界 (> 1)', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ confidence: { gte: 1.5 } }).success).toBe(false)
  })

  it('多 leaf key 一起出现（strict）', async () => {
    const { BoolExprSchema } = await import('../src/lib/schemas.js')
    expect(BoolExprSchema.safeParse({ tag: 'x', tagSlug: 'y' }).success).toBe(false)
  })
})

// ── D-2. OR-merge 优化 (#71) ────────────────────────────────────────────
// 所有 OR 子节点均为可解析为 tagId 集合的 leaf 时，编译器将它们合并为
// 单个 existsByTagIds(ANY([...]))，而非 N 个独立 EXISTS subplan。
// 以下用例验证合并路径的语义正确性（与非合并路径结果一致）。

describe('compileBoolExpr — OR-merge 优化', () => {
  it('全 tag leaf：or: [{tag:A},{tag:B}] 合并命中并集', async () => {
    const g  = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const tB = await makeTag({ groupId: g.id, slug: 'hunan' })
    const eA   = await makeEntity('dish')
    const eB   = await makeEntity('dish')
    const eAB  = await makeEntity('dish')
    const eNone = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eA.entityId })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: eB.entityId })
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eAB.entityId })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: eAB.entityId })
    void eNone

    expect(await runFilter('dish', { or: [{ tag: tA.id }, { tag: tB.id }] }))
      .toEqual([eA.entityId, eB.entityId, eAB.entityId].sort())
  })

  it('全 tagSlug leaf：or 合并后语义不变', async () => {
    const g  = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const tB = await makeTag({ groupId: g.id, slug: 'hunan' })
    const eA = await makeEntity('dish')
    const eB = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eA.entityId })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: eB.entityId })

    expect(await runFilter('dish', { or: [{ tagSlug: 'sichuan', groupSlug: g.slug }, { tagSlug: 'hunan', groupSlug: g.slug }] }))
      .toEqual([eA.entityId, eB.entityId].sort())
  })

  it('tag + tagSlug 混合：canMerge=true，命中正确', async () => {
    const g  = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const tB = await makeTag({ groupId: g.id, slug: 'hunan' })
    const eA = await makeEntity('dish')
    const eB = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eA.entityId })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: eB.entityId })

    // tA by id, tB by slug — should still merge
    expect(await runFilter('dish', { or: [{ tag: tA.id }, { tagSlug: 'hunan', groupSlug: g.slug }] }))
      .toEqual([eA.entityId, eB.entityId].sort())
  })

  it('source 子节点导致 canMerge=false，退回独立 EXISTS，语义正确', async () => {
    const g  = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const eTag  = await makeEntity('dish')
    const eAi   = await makeEntity('dish')
    const eNone = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eTag.entityId, source: 'manual' as any })
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eAi.entityId,  source: 'ai'     as any })
    void eNone

    // or: [{tag:A}, {source:['ai']}] — source 不可合并；退回两个独立 EXISTS
    // eTag (manual, non-ai) 仅因 tag 命中；eAi 两个条件都满足但只计一次
    expect(await runFilter('dish', { or: [{ tag: tA.id }, { source: ['ai'] }] }))
      .toEqual([eTag.entityId, eAi.entityId].sort())
  })

  it('OR 子节点之一 slug 不存在（解析为空数组），合并后仍正确命中另一个', async () => {
    const g  = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const eA = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eA.entityId })

    // no-such-slug 解析为 []，tag 解析为 [tA.id]；合并集合 = [tA.id]
    expect(await runFilter('dish', { or: [{ tagSlug: 'no-such-slug' }, { tag: tA.id }] }))
      .toEqual([eA.entityId])
  })

  it('OR 子节点全部解析为空 tagId，合并产生 FALSE（返回空集）', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { or: [{ tagSlug: 'ghost-a' }, { tagSlug: 'ghost-b' }] }))
      .toEqual([])
  })

  it('重复 tagId 去重后不影响结果（幂等）', async () => {
    const g  = await makeGroup({ slug: 'cuisine' })
    const tA = await makeTag({ groupId: g.id, slug: 'sichuan' })
    const eA = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: eA.entityId })

    // 同一 tagId 出现两次；合并后 Set 去重，只剩一个
    expect(await runFilter('dish', { or: [{ tag: tA.id }, { tag: tA.id }] }))
      .toEqual([eA.entityId])
  })

  it('tag + descendantOf 混合：合并后命中根节点的全部子孙', async () => {
    const g      = await makeGroup({ slug: 'cuisine' })
    const root   = await makeTagWithPath({ groupId: g.id, slug: 'chinese' })
    const child  = await makeTagWithPath({ groupId: g.id, slug: 'sichuan', parentPath: root.path })
    const tOther = await makeTag({ groupId: g.id, slug: 'italian' })

    const eChild  = await makeEntity('dish')
    const eOther  = await makeEntity('dish')
    await attachTag({ tagId: child.id,  entityType: 'dish', entityId: eChild.entityId })
    await attachTag({ tagId: tOther.id, entityType: 'dish', entityId: eOther.entityId })

    // descendantOf root + tag italian → 两个可合并 leaf
    expect(await runFilter('dish', { or: [{ descendantOf: root.id }, { tag: tOther.id }] }))
      .toEqual([eChild.entityId, eOther.entityId].sort())
  })
})

// ── E. SQL 注入防御 ──────────────────────────────────────────────────────

describe('compileBoolExpr — SQL 注入防御', () => {
  it('tagSlug 含特殊字符不应抛 500，应返回空集', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { tagSlug: "'; DROP TABLE \"Tag\"; --" })).toEqual([])
    // 验证 Tag 表还在
    const count = await prisma.tag.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  it('tag id 含特殊字符不应抛 500', async () => {
    await makeEntity('dish')
    expect(await runFilter('dish', { tag: "'; DROP TABLE \"Tag\"; --" })).toEqual([])
  })
})

// ── F. HTTP 路由层：响应字段约束 ──────────────────────────────────────────

describe('POST /search/entities — 路由层响应字段', () => {
  let app: ReturnType<typeof buildApp>
  let token: string
  let savedEnvToken: string | undefined

  beforeAll(() => {
    savedEnvToken = process.env.API_TOKEN
    process.env.API_TOKEN = 'ct_' + randomBytes(16).toString('hex')
    app = buildApp({ silent: true })
  })

  beforeEach(async () => {
    const raw = 'ct_' + randomBytes(16).toString('hex')
    await prisma.apiToken.create({
      data: { name: 'test-reader', tokenHash: createHash('sha256').update(raw).digest('hex'), role: 'reader', scopes: [] },
    })
    token = raw
  })

  afterAll(async () => {
    await prisma.apiToken.deleteMany()
    if (savedEnvToken !== undefined) process.env.API_TOKEN = savedEnvToken
    else delete process.env.API_TOKEN
  })

  async function call(body: unknown) {
    return app.fetch(new Request('http://test/search/entities', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    }))
  }

  it('空 and → 400', async () => {
    const res = await call({ entityType: 'dish', filter: { and: [] } })
    expect(res.status).toBe(400)
  })

  it('pagination total / page / pageSize 一致', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    for (let i = 0; i < 3; i++) {
      const e = await makeEntity('dish')
      await attachTag({ tagId: t.id, entityType: 'dish', entityId: e.entityId })
    }
    const res  = await call({ entityType: 'dish', page: 1, pageSize: 2 })
    expect(res.status).toBe(200)
    const json = await res.json() as { code: number; data: { items: unknown[]; total: number; page: number; pageSize: number } }
    expect(json.code).toBe(0)
    expect(json.data.total).toBe(3)
    expect(json.data.page).toBe(1)
    expect(json.data.pageSize).toBe(2)
    expect(json.data.items).toHaveLength(2)
  })

  it('sort=taggedAt:desc 按 MAX(EntityTag.createdAt) 排序', async () => {
    const g = await makeGroup()
    const t = await makeTag({ groupId: g.id })
    const eOld = await makeEntity('dish')
    const eNew = await makeEntity('dish')
    // 先打老的，再打新的
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eOld.entityId })
    await new Promise(r => setTimeout(r, 20))
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: eNew.entityId })

    const res = await call({ entityType: 'dish', sort: 'taggedAt:desc' })
    const json = await res.json() as { data: { items: Array<{ entityId: string }> } }
    expect(json.data.items.map(i => i.entityId)).toEqual([eNew.entityId, eOld.entityId])
  })

  it('include=tags 返回 active 标签且每实体不重复', async () => {
    const g = await makeGroup()
    const tA = await makeTag({ groupId: g.id })
    const tB = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish')
    await attachTag({ tagId: tA.id, entityType: 'dish', entityId: e.entityId, status: TagStatus.active })
    await attachTag({ tagId: tB.id, entityType: 'dish', entityId: e.entityId, status: TagStatus.active })
    // pending 不应混入
    const tP = await makeTag({ groupId: g.id })
    await attachTag({ tagId: tP.id, entityType: 'dish', entityId: e.entityId, status: TagStatus.pending })

    const res = await call({ entityType: 'dish', include: ['tags'] })
    const json = await res.json() as { data: { items: Array<{ entityId: string; tags: Array<{ id: string; status: string }> }> } }
    const item = json.data.items.find(i => i.entityId === e.entityId)!
    expect(item.tags).toHaveLength(2)
    expect(item.tags.every(t => t.status === 'active')).toBe(true)
    const uniqIds = new Set(item.tags.map(t => t.id))
    expect(uniqIds.size).toBe(item.tags.length)
  })

  it('facets=groupId 按 count desc 排序', async () => {
    const g = await makeGroup({ slug: 'cuisine' })
    const tHot  = await makeTag({ groupId: g.id, slug: 'hot' })
    const tCold = await makeTag({ groupId: g.id, slug: 'cold' })
    // hot 出现 3 次，cold 1 次
    for (let i = 0; i < 3; i++) {
      const e = await makeEntity('dish')
      await attachTag({ tagId: tHot.id, entityType: 'dish', entityId: e.entityId })
    }
    const e = await makeEntity('dish')
    await attachTag({ tagId: tCold.id, entityType: 'dish', entityId: e.entityId })

    const res = await call({ entityType: 'dish', facets: ['groupId'] })
    const json = await res.json() as {
      data: { facets: { groupId: Record<string, Array<{ tagSlug: string; count: number }>> } }
    }
    const list = json.data.facets.groupId.cuisine
    expect(list.map(x => x.tagSlug)).toEqual(['hot', 'cold'])
    expect(list[0].count).toBeGreaterThan(list[1].count)
  })
})
