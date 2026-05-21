/**
 * Concurrency tests for entity-tagging.
 *
 * Verifies the FOR UPDATE row-lock on RegisteredEntity serializes
 * concurrent POST/PUT requests against the same entity, so the
 * allowMultiple=false constraint cannot be violated by interleaved writes.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma } from './helpers.js'
import { makeGroup, makeTag, makeEntity } from './helpers.js'

let app: ReturnType<typeof buildApp>
beforeAll(() => { app = buildApp({ silent: true }) })

async function postTag(entityType: string, entityId: string, tagId: string, body: Record<string, unknown> = {}) {
  return app.request(`/entities/${entityType}/${entityId}/tags/${tagId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function putTags(entityType: string, entityId: string, tagIds: string[]) {
  return app.request(`/entities/${entityType}/${entityId}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagIds }),
  })
}

describe('allowMultiple concurrency', () => {
  it('concurrent POST of TWO different tags from a single-select group → exactly ONE active', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const tagA  = await makeTag({ groupId: group.id })
    const tagB  = await makeTag({ groupId: group.id })
    const entity = await makeEntity('dish')

    const [resA, resB] = await Promise.all([
      postTag(entity.entityType, entity.entityId, tagA.id),
      postTag(entity.entityType, entity.entityId, tagB.id),
    ])

    // 一个成功、一个 422 拒绝
    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 422])

    const active = await prisma.entityTag.findMany({
      where: { entityType: 'dish', entityId: entity.entityId, status: 'active' },
    })
    expect(active).toHaveLength(1)
  })

  it('PUT-then-POST race on a single-select group does not produce two active tags', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const tagA  = await makeTag({ groupId: group.id })
    const tagB  = await makeTag({ groupId: group.id })
    const entity = await makeEntity('dish')

    // PUT 全量替换 + 并发 POST 另一个标签
    const [putRes, postRes] = await Promise.all([
      putTags(entity.entityType, entity.entityId, [tagA.id]),
      postTag(entity.entityType, entity.entityId, tagB.id),
    ])

    // 两个不可能都成功并保留两条 active
    const active = await prisma.entityTag.findMany({
      where: { entityType: 'dish', entityId: entity.entityId, status: 'active' },
    })
    expect(active.length).toBeLessThanOrEqual(1)
    // 至少一个请求成功（否则 PUT 锁有问题）
    const anyOk = putRes.status === 200 || postRes.status === 200
    expect(anyOk).toBe(true)
  })

  it('PUT with a single-select group and TWO tags from that group → 422 (validateTags catches it)', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const a = await makeTag({ groupId: group.id })
    const b = await makeTag({ groupId: group.id })
    const entity = await makeEntity('dish')

    const r = await putTags(entity.entityType, entity.entityId, [a.id, b.id])
    expect(r.status).toBe(422)
  })

  it('multi-select group: concurrent POST of two tags → both succeed', async () => {
    const group = await makeGroup({ allowMultiple: true })
    const a = await makeTag({ groupId: group.id })
    const b = await makeTag({ groupId: group.id })
    const entity = await makeEntity('dish')

    const [r1, r2] = await Promise.all([
      postTag(entity.entityType, entity.entityId, a.id),
      postTag(entity.entityType, entity.entityId, b.id),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    const active = await prisma.entityTag.findMany({
      where: { entityType: 'dish', entityId: entity.entityId, status: 'active' },
    })
    expect(active).toHaveLength(2)
  })
})
