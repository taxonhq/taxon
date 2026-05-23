/**
 * entity-audit.ts 标签过滤模式测试。
 *
 * 验证 GET /entities/:entityType?tagId=...（ALL 模式）：
 *   - 有 LIMIT / OFFSET，不会一次性返回无界结果
 *   - 分页结构 { items, total, page, pageSize } 字段完整
 *   - 两页合集恰好覆盖全部实体且无重叠
 *   - 部分匹配（只有一个 tag）的实体不出现在结果中
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag } from './helpers.js'

let app: ReturnType<typeof buildApp>
beforeAll(() => { app = buildApp({ silent: true }) })

// ── helpers ────────────────────────────────────────────────────────

async function get(path: string) {
  const res  = await app.request(path)
  const body = await res.json() as { code: number; data: unknown }
  return { status: res.status, body }
}

// ── ALL 模式分页 ────────────────────────────────────────────────────

describe('GET /entities/:entityType — tagId ALL 模式', () => {
  it('100 实体 pageSize=50 → 两页合集覆盖全部且无重叠', async () => {
    const group = await makeGroup({ allowMultiple: true })
    const tagA  = await makeTag({ groupId: group.id, slug: 'tag-a', name: 'Tag A' })
    const tagB  = await makeTag({ groupId: group.id, slug: 'tag-b', name: 'Tag B' })

    // 批量插入 100 个实体，每个实体同时持有 tagA 和 tagB
    const entities = Array.from({ length: 100 }, (_, i) => ({
      entityType:   'dish',
      entityId:     `audit-test-${String(i).padStart(3, '0')}`,
    }))
    await prisma.registeredEntity.createMany({ data: entities })
    await prisma.entityTag.createMany({
      data: entities.flatMap(e => [
        { tagId: tagA.id, entityType: e.entityType, entityId: e.entityId, source: 'manual', status: 'active' },
        { tagId: tagB.id, entityType: e.entityType, entityId: e.entityId, source: 'manual', status: 'active' },
      ]),
    })

    const url = `/entities/dish?tagId=${tagA.id}&tagId=${tagB.id}`

    // 第 1 页
    const { body: b1 } = await get(`${url}&pageSize=50&page=1`)
    expect(b1.code).toBe(0)
    const d1 = b1.data as { items: { entityId: string }[]; total: number; page: number; pageSize: number }
    expect(d1.total).toBe(100)
    expect(d1.page).toBe(1)
    expect(d1.pageSize).toBe(50)
    expect(d1.items).toHaveLength(50)

    // 第 2 页
    const { body: b2 } = await get(`${url}&pageSize=50&page=2`)
    const d2 = b2.data as { items: { entityId: string }[]; total: number }
    expect(d2.total).toBe(100)
    expect(d2.items).toHaveLength(50)

    // 两页无重叠
    const ids1 = new Set(d1.items.map(i => i.entityId))
    const ids2 = d2.items.map(i => i.entityId)
    expect(ids2.every(id => !ids1.has(id))).toBe(true)

    // 两页合并恰好 100 个不同 entityId
    expect(new Set([...ids1, ...ids2]).size).toBe(100)
  })

  it('只满足部分 tag 的实体不出现在结果中', async () => {
    const group   = await makeGroup({ allowMultiple: true })
    const tagA    = await makeTag({ groupId: group.id, slug: 'partial-a', name: 'Partial A' })
    const tagB    = await makeTag({ groupId: group.id, slug: 'partial-b', name: 'Partial B' })

    // 仅打 tagA，不打 tagB
    await prisma.registeredEntity.create({ data: { entityType: 'dish', entityId: 'partial-entity' } })
    await prisma.entityTag.create({
      data: { tagId: tagA.id, entityType: 'dish', entityId: 'partial-entity', source: 'manual', status: 'active' },
    })

    const { body } = await get(`/entities/dish?tagId=${tagA.id}&tagId=${tagB.id}`)
    const d = body.data as { items: unknown[]; total: number }
    expect(d.items).toHaveLength(0)
    expect(d.total).toBe(0)
  })

  it('无结果时返回空分页结构', async () => {
    const group  = await makeGroup()
    const tagA   = await makeTag({ groupId: group.id, slug: 'no-match-a', name: 'No Match A' })
    const tagB   = await makeTag({ groupId: group.id, slug: 'no-match-b', name: 'No Match B' })

    const { body } = await get(`/entities/dish?tagId=${tagA.id}&tagId=${tagB.id}`)
    expect(body.code).toBe(0)
    const d = body.data as { items: unknown[]; total: number; page: number; pageSize: number }
    expect(d.items).toHaveLength(0)
    expect(d.total).toBe(0)
    expect(d.page).toBe(1)
    expect(d.pageSize).toBe(20)
  })

  it('pending 状态的 tag 不计入 ALL 匹配', async () => {
    const group = await makeGroup({ allowMultiple: true })
    const tagA  = await makeTag({ groupId: group.id, slug: 'pend-a', name: 'Pend A' })
    const tagB  = await makeTag({ groupId: group.id, slug: 'pend-b', name: 'Pend B' })

    // tagA active，tagB pending → 不应出现在 active ALL 结果中
    await prisma.registeredEntity.create({ data: { entityType: 'dish', entityId: 'pend-entity' } })
    await prisma.entityTag.createMany({
      data: [
        { tagId: tagA.id, entityType: 'dish', entityId: 'pend-entity', source: 'manual', status: 'active' },
        { tagId: tagB.id, entityType: 'dish', entityId: 'pend-entity', source: 'ai',     status: 'pending' },
      ],
    })

    const { body } = await get(`/entities/dish?tagId=${tagA.id}&tagId=${tagB.id}`)
    const d = body.data as { items: unknown[]; total: number }
    expect(d.items).toHaveLength(0)
    expect(d.total).toBe(0)
  })
})
