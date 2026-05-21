/**
 * Soft-delete behaviour tests.
 *
 * These are **characterization tests** that pin down the externally
 * observable contract of soft delete + recreation. They MUST keep
 * passing across the migration that swaps the current
 *   "append __deleted__<ts> to slug" hack
 * for partial unique indexes (`WHERE deletedAt IS NULL`).
 *
 * The implementation-detail check that the deleted record's slug
 * carries the `__deleted__` suffix lives in the separate
 * `soft-delete-current-hack.test.ts` file — that file gets removed
 * when the hack is removed.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma } from './helpers.js'

let app: ReturnType<typeof buildApp>
beforeAll(() => { app = buildApp({ silent: true }) })

// ── helpers ────────────────────────────────────────────────────────

async function createGroup(body: Record<string, unknown>) {
  return app.request('/tag-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function createTag(body: Record<string, unknown>) {
  return app.request('/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function deleteGroup(id: string, force = false) {
  return app.request(`/tag-groups/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' })
}

async function deleteTag(id: string, force = false) {
  return app.request(`/tags/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' })
}

// ── TagGroup soft delete invariants ────────────────────────────────

describe('TagGroup soft delete', () => {
  it('marks deletedAt and excludes the row from active listings', async () => {
    const create = await createGroup({ slug: 'cuisine', name: '菜系' })
    expect(create.status).toBe(200)
    const { data } = await create.json() as { data: { id: string } }

    expect((await deleteGroup(data.id)).status).toBe(200)

    // Active list excludes it
    const list = await (await app.request('/tag-groups')).json() as { data: { items: unknown[] } }
    expect(list.data.items).toHaveLength(0)

    // Row still exists, deletedAt set
    const row = await prisma.tagGroup.findUnique({ where: { id: data.id } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).toBeInstanceOf(Date)
  })

  it('allows recreating with the same slug + name after soft delete', async () => {
    const first = await createGroup({ slug: 'cuisine', name: '菜系' })
    const { data: firstData } = await first.json() as { data: { id: string } }
    await deleteGroup(firstData.id)

    const second = await createGroup({ slug: 'cuisine', name: '菜系' })
    expect(second.status).toBe(200)
    const { data: secondData } = await second.json() as { data: { id: string } }
    expect(secondData.id).not.toBe(firstData.id)
  })

  it('keeps the original slug/name on soft delete (no __deleted__ suffix mangling)', async () => {
    // 部分唯一索引方案下，软删除只置 deletedAt，slug/name 保持原值。
    const create = await createGroup({ slug: 'cuisine', name: '菜系' })
    const { data } = await create.json() as { data: { id: string } }
    await deleteGroup(data.id)

    const row = await prisma.tagGroup.findUnique({ where: { id: data.id } })
    expect(row!.slug).toBe('cuisine')
    expect(row!.name).toBe('菜系')
    expect(row!.slug).not.toMatch(/__deleted__/)
  })

  it('cycles delete→create→delete→create N times without 409 collisions', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const r = await createGroup({ slug: 'cycle', name: 'cycle-name' })
      expect(r.status).toBe(200)
      const { data } = await r.json() as { data: { id: string } }
      ids.push(data.id)
      const d = await deleteGroup(data.id)
      expect(d.status).toBe(200)
    }
    expect(new Set(ids).size).toBe(5)
  })

  it('rejects creating a group whose slug collides with an ACTIVE one', async () => {
    await createGroup({ slug: 'dup', name: '维度1' })
    const r = await createGroup({ slug: 'dup', name: '维度2' })
    expect(r.status).toBe(409)
  })

  it('rejects creating a group whose name collides with an ACTIVE one', async () => {
    await createGroup({ slug: 'a', name: 'shared-name' })
    const r = await createGroup({ slug: 'b', name: 'shared-name' })
    expect(r.status).toBe(409)
  })
})

// ── Tag soft delete invariants ─────────────────────────────────────

describe('Tag soft delete', () => {
  async function newGroupId(slug = 'g') {
    const r = await createGroup({ slug, name: slug })
    const { data } = await r.json() as { data: { id: string } }
    return data.id
  }

  it('marks deletedAt and frees slug/name for recreation within the same group', async () => {
    const groupId = await newGroupId('cuisine')

    const t1 = await createTag({ groupId, slug: 'sichuan', name: '川菜' })
    expect(t1.status).toBe(200)
    const { data: t1Data } = await t1.json() as { data: { id: string } }

    expect((await deleteTag(t1Data.id)).status).toBe(200)

    const t2 = await createTag({ groupId, slug: 'sichuan', name: '川菜' })
    expect(t2.status).toBe(200)
    const { data: t2Data } = await t2.json() as { data: { id: string } }
    expect(t2Data.id).not.toBe(t1Data.id)
  })

  it('rejects creating a tag whose slug collides with an ACTIVE tag in the same group', async () => {
    const groupId = await newGroupId('cuisine2')
    await createTag({ groupId, slug: 'sichuan', name: '川菜' })
    const r = await createTag({ groupId, slug: 'sichuan', name: '川菜v2' })
    expect(r.status).toBe(409)
  })

  it('allows the same slug across DIFFERENT groups (uniqueness is per-group)', async () => {
    const g1 = await newGroupId('g1')
    const g2 = await newGroupId('g2')

    expect((await createTag({ groupId: g1, slug: 'shared', name: 'a' })).status).toBe(200)
    expect((await createTag({ groupId: g2, slug: 'shared', name: 'b' })).status).toBe(200)
  })

  it('multiple soft-deleted tags can coexist with the SAME original slug in the same group', async () => {
    // 这是支持 #1 部分唯一索引的关键不变量：
    // partial index 应允许任意多条 deletedAt IS NOT NULL 的同名记录
    const groupId = await newGroupId('multi')
    const created: string[] = []

    for (let i = 0; i < 3; i++) {
      const r = await createTag({ groupId, slug: 'recurring', name: '复用名' })
      expect(r.status).toBe(200)
      const { data } = await r.json() as { data: { id: string } }
      created.push(data.id)
      expect((await deleteTag(data.id)).status).toBe(200)
    }

    // 数据库里应该有 3 条软删除的同名记录
    const deletedRows = await prisma.tag.findMany({
      where: { groupId, deletedAt: { not: null } },
    })
    expect(deletedRows).toHaveLength(3)
    expect(new Set(deletedRows.map(r => r.id)).size).toBe(3)
  })
})
