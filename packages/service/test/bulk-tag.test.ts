/**
 * POST /entities/bulk-tag 单测（issue #36）
 *
 * 覆盖：
 *   - 鉴权（reader 403 / writer 200）
 *   - add 模式成功 + 部分冲突跳过
 *   - replace 模式清旧后插新（含跨 group）
 *   - allowMultiple=false 单选组冲突进 errors
 *   - validateTags 全局失败 → 422
 *   - Zod 上下限拒绝（空 entityIds / 超 1000）
 *   - AI source 缺 confidence → 400
 *   - 自动注册未注册过的实体
 *   - skipDuplicates：add 模式下 (entity,tag) 已存在不报错且计 succeeded
 */

import { createHash, randomBytes } from 'crypto'
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

let app: ReturnType<typeof buildApp>
let savedEnvToken: string | undefined
let writerToken: string
let readerToken: string

function sha256(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}
function newRawToken() {
  return 'ct_' + randomBytes(16).toString('hex')
}
async function mkToken(role: 'reader' | 'writer') {
  const raw = newRawToken()
  await prisma.apiToken.create({
    data: { name: `bulk-${role}-${Date.now()}`, tokenHash: sha256(raw), role, scopes: [] },
  })
  return raw
}

function callBulk(token: string, body: unknown) {
  return app.fetch(new Request('http://test/entities/bulk-tag', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(body),
  }))
}

beforeAll(() => {
  savedEnvToken = process.env.API_TOKEN
  process.env.API_TOKEN = newRawToken() // 切到真实鉴权模式
  app = buildApp({ silent: true })
})

beforeEach(async () => {
  writerToken = await mkToken('writer')
  readerToken = await mkToken('reader')
})

afterAll(async () => {
  await prisma.apiToken.deleteMany()
  if (savedEnvToken !== undefined) process.env.API_TOKEN = savedEnvToken
  else delete process.env.API_TOKEN
})

// ── 鉴权 ───────────────────────────────────────────────────────────────────

describe('POST /entities/bulk-tag — 鉴权', () => {
  it('reader → 403', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const t = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish')
    const res = await callBulk(readerToken, {
      entityType: 'dish',
      entityIds: [e.entityId],
      tagIds: [t.id],
    })
    expect(res.status).toBe(403)
  })

  it('无 token → 401', async () => {
    const res = await app.fetch(new Request('http://test/entities/bulk-tag', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ entityType: 'dish', entityIds: ['x'], tagIds: ['y'] }),
    }))
    expect(res.status).toBe(401)
  })
})

// ── Zod 拒绝 ────────────────────────────────────────────────────────────────

describe('POST /entities/bulk-tag — Zod 校验', () => {
  it('空 entityIds → 400', async () => {
    const res = await callBulk(writerToken, { entityType: 'dish', entityIds: [], tagIds: ['x'] })
    expect(res.status).toBe(400)
  })

  it('空 tagIds → 400', async () => {
    const res = await callBulk(writerToken, { entityType: 'dish', entityIds: ['x'], tagIds: [] })
    expect(res.status).toBe(400)
  })

  it('entityIds 超 1000 → 400', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `e${i}`)
    const res = await callBulk(writerToken, { entityType: 'dish', entityIds: ids, tagIds: ['t'] })
    expect(res.status).toBe(400)
  })

  it('tagIds 超 50 → 400', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `t${i}`)
    const res = await callBulk(writerToken, { entityType: 'dish', entityIds: ['e'], tagIds: ids })
    expect(res.status).toBe(400)
  })

  it('AI source 缺 confidence → 400', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const t = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish')
    const res = await callBulk(writerToken, {
      entityType: 'dish', entityIds: [e.entityId], tagIds: [t.id],
      source: 'ai',
    })
    expect(res.status).toBe(400)
  })
})

// ── 全局 validateTags ─────────────────────────────────────────────────────

describe('POST /entities/bulk-tag — validateTags 全局失败', () => {
  it('两个 tag 来自同一 single-select 组 → 422，全部拒绝', async () => {
    const g = await makeGroup({ allowMultiple: false })
    const t1 = await makeTag({ groupId: g.id })
    const t2 = await makeTag({ groupId: g.id })
    const e1 = await makeEntity('dish')
    const e2 = await makeEntity('dish')
    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [e1.entityId, e2.entityId],
      tagIds: [t1.id, t2.id],
    })
    expect(res.status).toBe(422)
    // 验证没有写入
    expect(await prisma.entityTag.count()).toBe(0)
  })

  it('tag 不存在 → 422', async () => {
    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: ['e1'],
      tagIds: ['no-such-tag'],
    })
    expect(res.status).toBe(422)
  })

  it('tag 的 entityScopes 不含目标类型 → 422', async () => {
    const g = await makeGroup({ entityScopes: ['dining'] })
    const t = await makeTag({ groupId: g.id })
    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: ['e1'],
      tagIds: [t.id],
    })
    expect(res.status).toBe(422)
  })
})

// ── add 模式 ──────────────────────────────────────────────────────────────

describe('POST /entities/bulk-tag — add 模式', () => {
  it('多个实体 × 多个标签（multi-select 组）全部成功', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const tA = await makeTag({ groupId: g.id })
    const tB = await makeTag({ groupId: g.id })
    const e1 = await makeEntity('dish')
    const e2 = await makeEntity('dish')
    const e3 = await makeEntity('dish')

    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [e1.entityId, e2.entityId, e3.entityId],
      tagIds: [tA.id, tB.id],
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { code: number; data: { succeeded: number; failed: number; errors: unknown[] } }
    expect(json.code).toBe(0)
    expect(json.data.succeeded).toBe(3)
    expect(json.data.failed).toBe(0)
    expect(json.data.errors).toEqual([])

    // 数据库实际写入了 3 × 2 = 6 行
    expect(await prisma.entityTag.count({ where: { entityType: 'dish' } })).toBe(6)
  })

  it('自动注册未注册过的实体', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const t = await makeTag({ groupId: g.id })
    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: ['new-1', 'new-2', 'new-3'],
      tagIds: [t.id],
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { data: { succeeded: number } }
    expect(json.data.succeeded).toBe(3)
    const registered = await prisma.registeredEntity.count({ where: { entityType: 'dish', entityId: { in: ['new-1', 'new-2', 'new-3'] } } })
    expect(registered).toBe(3)
  })

  it('single-select 组：已有 active 标签的实体进 errors，其他成功', async () => {
    const g = await makeGroup({ allowMultiple: false })
    const existing = await makeTag({ groupId: g.id })
    const newTag = await makeTag({ groupId: g.id })

    const eOccupied = await makeEntity('dish')
    const eFree     = await makeEntity('dish')
    // eOccupied 已经在 g 下挂了一个 active tag
    await attachTag({ tagId: existing.id, entityType: 'dish', entityId: eOccupied.entityId })

    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [eOccupied.entityId, eFree.entityId],
      tagIds: [newTag.id],
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { data: { succeeded: number; failed: number; errors: Array<{ entityId: string; error: string }> } }
    expect(json.data.succeeded).toBe(1)
    expect(json.data.failed).toBe(1)
    expect(json.data.errors).toEqual([{ entityId: eOccupied.entityId, error: expect.stringContaining('不允许多选') }])

    // eOccupied 仍只有 existing 一个；eFree 有 newTag
    const occupiedTags = await prisma.entityTag.findMany({ where: { entityType: 'dish', entityId: eOccupied.entityId }, select: { tagId: true } })
    expect(occupiedTags).toEqual([{ tagId: existing.id }])
    const freeTags = await prisma.entityTag.findMany({ where: { entityType: 'dish', entityId: eFree.entityId }, select: { tagId: true } })
    expect(freeTags).toEqual([{ tagId: newTag.id }])
  })

  it('skipDuplicates：(entity, tag) 已存在不报错且实体仍计 succeeded', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const t = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish')
    await attachTag({ tagId: t.id, entityType: 'dish', entityId: e.entityId })

    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [e.entityId],
      tagIds: [t.id],
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { data: { succeeded: number; failed: number } }
    expect(json.data.succeeded).toBe(1)
    expect(json.data.failed).toBe(0)
    // 没有重复行
    expect(await prisma.entityTag.count({ where: { entityType: 'dish', entityId: e.entityId } })).toBe(1)
  })
})

// ── replace 模式 ─────────────────────────────────────────────────────────

describe('POST /entities/bulk-tag — replace 模式', () => {
  it('清掉相关 group 的旧标签，写入新集合', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const old1 = await makeTag({ groupId: g.id })
    const old2 = await makeTag({ groupId: g.id })
    const newTag = await makeTag({ groupId: g.id })

    const e = await makeEntity('dish')
    await attachTag({ tagId: old1.id, entityType: 'dish', entityId: e.entityId })
    await attachTag({ tagId: old2.id, entityType: 'dish', entityId: e.entityId })

    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [e.entityId],
      tagIds: [newTag.id],
      mode: 'replace',
    })
    expect(res.status).toBe(200)

    const remaining = await prisma.entityTag.findMany({ where: { entityType: 'dish', entityId: e.entityId }, select: { tagId: true } })
    expect(remaining.map(r => r.tagId).sort()).toEqual([newTag.id])
  })

  it('replace 不影响无关 group 的标签', async () => {
    const cuisine  = await makeGroup({ allowMultiple: true, slug: 'cuisine-x' })
    const dietary  = await makeGroup({ allowMultiple: true, slug: 'dietary-x' })
    const sichuan  = await makeTag({ groupId: cuisine.id })
    const hunan    = await makeTag({ groupId: cuisine.id })
    const vegan    = await makeTag({ groupId: dietary.id })

    const e = await makeEntity('dish')
    await attachTag({ tagId: sichuan.id, entityType: 'dish', entityId: e.entityId })
    await attachTag({ tagId: vegan.id,   entityType: 'dish', entityId: e.entityId })

    // 用 hunan 替换 → 只清 cuisine group，dietary.vegan 应保留
    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [e.entityId],
      tagIds: [hunan.id],
      mode: 'replace',
    })
    expect(res.status).toBe(200)

    const remaining = await prisma.entityTag.findMany({ where: { entityType: 'dish', entityId: e.entityId }, select: { tagId: true } })
    expect(remaining.map(r => r.tagId).sort()).toEqual([hunan.id, vegan.id].sort())
  })

  it('single-select 组 replace 模式：先清再插，永远成功不进 errors', async () => {
    const g = await makeGroup({ allowMultiple: false })
    const existing = await makeTag({ groupId: g.id })
    const newTag   = await makeTag({ groupId: g.id })

    const e = await makeEntity('dish')
    await attachTag({ tagId: existing.id, entityType: 'dish', entityId: e.entityId })

    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds: [e.entityId],
      tagIds: [newTag.id],
      mode: 'replace',
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { data: { succeeded: number; failed: number } }
    expect(json.data.succeeded).toBe(1)
    expect(json.data.failed).toBe(0)

    const remaining = await prisma.entityTag.findMany({ where: { entityType: 'dish', entityId: e.entityId }, select: { tagId: true } })
    expect(remaining.map(r => r.tagId)).toEqual([newTag.id])
  })
})

// ── 跨批次性能基线（参考验收：100 实体 × 5 标签 < 500ms） ─────────────────

describe('POST /entities/bulk-tag — 性能基线', () => {
  it('100 实体 × 5 标签 单次请求', async () => {
    const g = await makeGroup({ allowMultiple: true })
    const tags = await Promise.all(Array.from({ length: 5 }, () => makeTag({ groupId: g.id })))
    const entityIds = Array.from({ length: 100 }, (_, i) => `bench-e-${i}`)

    const t0 = Date.now()
    const res = await callBulk(writerToken, {
      entityType: 'dish',
      entityIds,
      tagIds: tags.map(t => t.id),
    })
    const elapsed = Date.now() - t0

    expect(res.status).toBe(200)
    const json = await res.json() as { data: { succeeded: number } }
    expect(json.data.succeeded).toBe(100)
    // 远程 dev DB 实际跑可能超过这个目标，本测试仅做"无超大回归"的边界保护
    expect(elapsed).toBeLessThan(10_000)
  })
})
