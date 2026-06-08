/**
 * P0: 物化路径正确性回归防线 (#146)
 *
 * 验证 path 前缀查询在所有路径中都加了 groupId 约束，防止跨分组数据污染。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

let app: ReturnType<typeof buildApp>
beforeAll(() => { app = buildApp({ silent: true }) })

async function postJSON(path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

async function patchJSON(path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

async function postSearch(body: unknown) {
  const res = await app.request('/search/entities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

// ── helpers ────────────────────────────────────────────────────────

async function createTag(groupId: string, name: string, parentId?: string) {
  const body: Record<string, unknown> = { groupId, name, slug: name }
  if (parentId) body.parentId = parentId
  const res = await postJSON('/tags', body)
  expect(res.status).toBe(200)
  return (res.body as { data: { id: string; path: string; groupId: string } }).data
}

async function createChild(groupId: string, parentId: string, name: string) {
  return createTag(groupId, name, parentId)
}

/** descendants returns { code, data: { items, total } } */
async function getDescendants(tagId: string) {
  const res = await get(`/tags/${tagId}/descendants`)
  expect(res.status).toBe(200)
  return (res.body as { code: number; data: { items: { id: string }[]; total: number } }).data.items
}

// ── MP-01: 同名 slug 在不同分组 → descendants 不跨组返回 ──────────
describe('MP-01: descendants scoped to groupId', () => {
  it('same slug in two groups → descendants query only returns within group', async () => {
    const g1 = await makeGroup({ slug: 'cuisine-mp01' })
    const g2 = await makeGroup({ slug: 'dietary-mp01' })

    const t1 = await createTag(g1.id, 'spicy')
    const t2 = await createTag(g2.id, 'spicy')

    await createChild(g1.id, t1.id, 'mala')
    await createChild(g1.id, t1.id, 'sichuan-pepper')
    await createChild(g2.id, t2.id, 'wasabi')

    const d1 = await getDescendants(t1.id)
    expect(d1.length).toBe(2)

    const d2 = await getDescendants(t2.id)
    expect(d2.length).toBe(1)
  })
})

// ── MP-02: rename tag → 子孙 path 前缀替换，仅同组内更新 ──────────
describe('MP-02: rename scoped to groupId', () => {
  it('rename parent → children path updated, other-group same-prefix untouched', async () => {
    const g1 = await makeGroup({ slug: 'cuisine-mp02' })
    const g2 = await makeGroup({ slug: 'dietary-mp02' })

    const t1 = await createTag(g1.id, 'spicy')
    const child1 = await createChild(g1.id, t1.id, 'mala')

    const t2 = await createTag(g2.id, 'spicy')
    const child2 = await createChild(g2.id, t2.id, 'wasabi')

    // Rename g1/spicy → hot
    const r = await patchJSON(`/tags/${t1.id}`, { slug: 'hot', name: 'hot' })
    expect(r.status).toBe(200)

    // Verify child1 path updated
    const c1 = await get(`/tags/${child1.id}`)
    const c1Data = (c1.body as { data: { path: string } }).data
    expect(c1Data.path).toContain('hot')
    expect(c1Data.path).not.toContain('spicy')

    // Verify child2 path NOT affected (different group)
    const c2 = await get(`/tags/${child2.id}`)
    const c2Data = (c2.body as { data: { path: string } }).data
    expect(c2Data.path).toContain('spicy')
    expect(c2Data.path).not.toContain('hot')
  })
})

// ── MP-03: 跨分组迁移 tag（含子孙）→ path 全量重算 ────────────────
describe('MP-03: move across groups — path rebuild', () => {
  it('moving tag with children to another group recalculates all paths', async () => {
    const g1 = await makeGroup({ slug: 'cuisine-mp03' })
    const g2 = await makeGroup({ slug: 'dietary-mp03' })

    const parent = await createTag(g1.id, 'spicy')
    const child = await createChild(g1.id, parent.id, 'mala')
    const grandchild = await createChild(g1.id, child.id, 'super-mala')

    // Move parent to g2 — path is /tags/{tagId}/move, body has targetGroupId + newParentId
    const r = await postJSON(`/tags/${parent.id}/move`, { targetGroupId: g2.id, newParentId: null })
    expect(r.status).toBe(200)

    // Verify all moved tags are now in g2
    const p = await get(`/tags/${parent.id}`)
    expect((p.body as { data: { groupId: string } }).data.groupId).toBe(g2.id)

    const c = await get(`/tags/${child.id}`)
    expect((c.body as { data: { groupId: string } }).data.groupId).toBe(g2.id)

    const gc = await get(`/tags/${grandchild.id}`)
    expect((gc.body as { data: { groupId: string } }).data.groupId).toBe(g2.id)
  })
})

// ── MP-04: 迁移后查询源组 descendants 不包含已迁移的子孙 ──────────
describe('MP-04: post-move source group descendants clean', () => {
  it('after moving, source group descendant query excludes moved tags', async () => {
    const g1 = await makeGroup({ slug: 'cuisine-mp04' })
    const g2 = await makeGroup({ slug: 'dietary-mp04' })

    const root = await createTag(g1.id, 'root')
    const toMove = await createChild(g1.id, root.id, 'to-move')
    const stay = await createChild(g1.id, root.id, 'stay')

    // Move 'to-move' to g2
    await postJSON(`/tags/${toMove.id}/move`, { targetGroupId: g2.id, newParentId: null })

    // root's descendants should only include 'stay', not 'to-move'
    const items = await getDescendants(root.id)
    const ids = items.map(d => d.id)
    expect(ids).toContain(stay.id)
    expect(ids).not.toContain(toMove.id)
  })
})

// ── MP-05: rename 后软删除的 tag 不在 path 更新范围内 ──────────────
describe('MP-05: rename skips soft-deleted tags', () => {
  it('soft-deleted children are not updated on parent rename', async () => {
    const g = await makeGroup({ slug: 'test-mp05' })
    const parent = await createTag(g.id, 'parent')
    const active = await createChild(g.id, parent.id, 'active')
    const deleted = await createChild(g.id, parent.id, 'deleted')

    // Soft-delete one child
    await app.request(`/tags/${deleted.id}`, { method: 'DELETE' })

    // Rename parent
    const r = await patchJSON(`/tags/${parent.id}`, { slug: 'renamed', name: 'renamed' })
    expect(r.status).toBe(200)

    // Active child path should be updated
    const a = await get(`/tags/${active.id}`)
    expect((a.body as { data: { path: string } }).data.path).toContain('renamed')

    // Deleted child should not exist via GET
    const d = await get(`/tags/${deleted.id}`)
    expect(d.status).toBe(404)
  })
})

// ── MP-06: descendantOf 搜索 → 编译后的 SQL 含 groupId 限定 ────────
describe('MP-06: descendantOf search scoped to groupId', () => {
  it('descendantOf search only matches within the same group', async () => {
    const g1 = await makeGroup({ slug: 'cuisine-mp06' })
    const g2 = await makeGroup({ slug: 'dietary-mp06' })

    const t1 = await createTag(g1.id, 'spicy')
    const c1 = await createChild(g1.id, t1.id, 'mala')
    const t2 = await createTag(g2.id, 'spicy')
    const c2 = await createChild(g2.id, t2.id, 'wasabi')

    // Register entities and tag them
    const e1 = await makeEntity('dish', 'dish-mp06-a')
    const e2 = await makeEntity('dish', 'dish-mp06-b')
    await attachTag({ tagId: c1.id, entityType: 'dish', entityId: e1.entityId })
    await attachTag({ tagId: c2.id, entityType: 'dish', entityId: e2.entityId })

    // Search descendantOf g1/spicy → should only find dish-mp06-a
    const r = await postSearch({
      entityType: 'dish',
      filter: { descendantOf: t1.id },
    })
    expect(r.status).toBe(200)
    const respData = r.body as { code: number; data: { items: { entityId: string }[] } }
    expect(respData.code).toBe(0)
    const entityIds = respData.data.items.map(i => i.entityId)
    expect(entityIds).toContain(e1.entityId)
    expect(entityIds).not.toContain(e2.entityId)
  })
})
