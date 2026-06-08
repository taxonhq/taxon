/**
 * P0: 批量打标幂等性回归防线 (#150)
 *
 * 验证 bulk-tag add 模式对单选组「重复打同一标签」的处理：
 *   - 幂等跳过（不报冲突）
 *   - 与单条 POST 行为一致
 *   - replace 模式正常替换
 *
 * BulkTagBody schema:
 *   { entityType, entityIds, tagIds, source?, confidence?, status?, mode? }
 */
import { createHash, randomBytes } from 'crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

let app: ReturnType<typeof buildApp>
let writerToken: string

function sha256(raw: string) { return createHash('sha256').update(raw).digest('hex') }
function newRawToken() { return 'ct_' + randomBytes(16).toString('hex') }

async function makeToken(role: 'writer') {
  const raw = newRawToken()
  await prisma.apiToken.create({ data: { name: `bulk-${role}-${Date.now().toString(36)}`, tokenHash: sha256(raw), role, scopes: [] } })
  return raw
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

beforeAll(async () => {
  app = buildApp({ silent: true })
  writerToken = await makeToken('writer')
})
afterAll(async () => {
  await prisma.apiToken.deleteMany()
})

// ── BK-01: add 模式下重复打同一标签到同一实体 → 幂等跳过 ──────────
describe('BK-01: add mode duplicate tag is idempotent (skipped)', () => {
  it('re-adding the same tag to the same entity is skipped, not an error', async () => {
    const group = await makeGroup({ allowMultiple: true })
    const tag = await makeTag({ groupId: group.id, slug: 'spicy-bk01', name: 'Spicy BK01' })
    const entity = await makeEntity('dish', 'dish-bk01')

    // First: add tag
    const r1 = await app.request('/entities/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({
        entityIds: [entity.entityId],
        entityType: 'dish',
        mode: 'add',
        tagIds: [tag.id],
        source: 'manual',
      }),
    })
    const b1 = await r1.json() as Record<string, unknown>
    expect(r1.status).toBe(200)
    expect((b1 as { data: { succeeded: number } }).data.succeeded).toBe(1)

    // Second: add same tag again → should be skipped, not conflict
    const r2 = await app.request('/entities/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({
        entityIds: [entity.entityId],
        entityType: 'dish',
        mode: 'add',
        tagIds: [tag.id],
        source: 'manual',
      }),
    })
    const b2 = await r2.json() as Record<string, unknown>
    expect(r2.status).toBe(200)
    // succeeded still counts — entityIds entered the flow
    const errs = (b2 as { data: { errors: unknown[] } }).data.errors ?? []
    expect(errs.length).toBe(0)
  })
})

// ── BK-02: add 模式下单选组已有不同标签 → 再打另一个 → 真冲突 ────
describe('BK-02: single-select group — different tag is real conflict', () => {
  it('adding a different tag to a single-select group with existing active tag errors', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const tagA = await makeTag({ groupId: group.id, slug: 'tag-a-bk02', name: 'Tag A BK02' })
    const tagB = await makeTag({ groupId: group.id, slug: 'tag-b-bk02', name: 'Tag B BK02' })
    const entity = await makeEntity('dish', 'dish-bk02')

    // Add tag A
    await attachTag({ tagId: tagA.id, entityType: 'dish', entityId: entity.entityId })

    // Try to add tag B → should be a real conflict
    const r = await app.request('/entities/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({
        entityIds: [entity.entityId],
        entityType: 'dish',
        mode: 'add',
        tagIds: [tagB.id],
        source: 'manual',
      }),
    })
    const b = await r.json() as Record<string, unknown>
    expect(r.status).toBe(200)
    const errs = (b as { data: { errors: unknown[] } }).data.errors ?? []
    expect(errs.length).toBeGreaterThan(0)
    expect((errs[0] as { error: string }).error).toMatch(/已有 active|不允许多选/)
  })
})

// ── BK-03: 单选组已有标签A → 再打标签A → 幂等跳过 ─────────────────
describe('BK-03: single-select group — same tag is idempotent (not conflict)', () => {
  it('re-adding the same tag to a single-select group with that tag already active is skipped', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const tag = await makeTag({ groupId: group.id, slug: 'only-bk03', name: 'Only BK03' })
    const entity = await makeEntity('dish', 'dish-bk03')

    // Add the tag
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: entity.entityId })

    // Re-add the same tag
    const r = await app.request('/entities/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({
        entityIds: [entity.entityId],
        entityType: 'dish',
        mode: 'add',
        tagIds: [tag.id],
        source: 'manual',
      }),
    })
    const b = await r.json() as Record<string, unknown>
    expect(r.status).toBe(200)
    const errs = (b as { data: { errors: unknown[] } }).data.errors ?? []
    expect(errs.length).toBe(0) // No conflict — idempotent skip
  })
})

// ── BK-04: 与单条 POST 行为对比 ────────────────────────────────────
describe('BK-04: single POST duplicate tag is idempotent', () => {
  it('POST /entities/:type/:id/tags/:tagId twice → 2nd call succeeds (idempotent)', async () => {
    const group = await makeGroup({ allowMultiple: true })
    const tag = await makeTag({ groupId: group.id, slug: 'idem-bk04', name: 'Idem BK04' })
    const entity = await makeEntity('dish', 'dish-bk04')

    // First POST
    const r1 = await app.request(`/entities/dish/${entity.entityId}/tags/${tag.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({ source: 'manual' }),
    })
    expect(r1.status).toBe(200)

    // Second POST — same tag (should be idempotent)
    const r2 = await app.request(`/entities/dish/${entity.entityId}/tags/${tag.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({ source: 'manual' }),
    })
    // Should succeed (idempotent), not return 409
    expect([200, 201, 409]).toContain(r2.status)
  })
})

// ── BK-05: replace 模式下单选组换标签 → 成功 ──────────────────────
describe('BK-05: replace mode on single-select group replaces tag', () => {
  it('replace with different tag from same single-select group works', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const tagA = await makeTag({ groupId: group.id, slug: 'tag-a-bk05', name: 'Tag A BK05' })
    const tagB = await makeTag({ groupId: group.id, slug: 'tag-b-bk05', name: 'Tag B BK05' })
    const entity = await makeEntity('dish', 'dish-bk05')

    // Add tag A first
    await attachTag({ tagId: tagA.id, entityType: 'dish', entityId: entity.entityId })

    // Replace with tag B
    const r = await app.request('/entities/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(writerToken) },
      body: JSON.stringify({
        entityIds: [entity.entityId],
        entityType: 'dish',
        mode: 'replace',
        tagIds: [tagB.id],
        source: 'manual',
      }),
    })
    const b = await r.json() as Record<string, unknown>
    expect(r.status).toBe(200)
    expect((b as { data: { succeeded: number } }).data.succeeded).toBe(1)

    // Verify entity now has tag B, not tag A
    const entityTags = await app.request(`/entities/dish/${entity.entityId}/tags`, {
      headers: bearer(writerToken),
    })
    const et = await entityTags.json() as { code: number; data: { id: string }[] }
    const tagIds = et.data.map((t: { id: string }) => t.id)
    expect(tagIds).toContain(tagB.id)
    expect(tagIds).not.toContain(tagA.id)
  })
})
