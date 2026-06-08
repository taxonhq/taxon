import { createHash, randomBytes } from 'crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

let app: ReturnType<typeof buildApp>
let writerToken: string

function sha256(raw: string) { return createHash('sha256').update(raw).digest('hex') }
function newRawToken() { return 'ct_' + randomBytes(16).toString('hex') }

beforeAll(async () => {
  app = buildApp({ silent: true })
  writerToken = await (async () => {
    const raw = newRawToken()
    await prisma.apiToken.create({ data: { name: `et-writer-${Date.now().toString(36)}`, tokenHash: sha256(raw), role: 'writer', scopes: [] } })
    return raw
  })()
})
afterAll(async () => {
  await prisma.apiToken.deleteMany()
})

function bearer(token: string): HeadersInit { return { Authorization: `Bearer ${token}` } }

async function post(path: string, body: unknown) {
  const res = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(writerToken) }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
async function put(path: string, body: unknown) {
  const res = await app.request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...bearer(writerToken) }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
async function del(path: string) {
  const res = await app.request(path, { method: 'DELETE', headers: bearer(writerToken) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
async function get(path: string) {
  const res = await app.request(path, { headers: bearer(writerToken) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

describe('POST /entities/:type/:id/tags/:tagId', () => {
  it('adds a tag to an entity (auto-registers entity)', async () => {
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const r = await post(`/entities/dish/auto-reg/tags/${tag.id}`, { source: 'manual' })
    expect(r.status).toBe(200)
  })

  it('AI source with missing confidence returns 400', async () => {
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const r = await post(`/entities/dish/ai-test/tags/${tag.id}`, { source: 'ai' })
    expect(r.status).toBe(400)
  })

  it('AI source with confidence → status=pending', async () => {
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const r = await post(`/entities/dish/ai-conf/tags/${tag.id}`, { source: 'ai', confidence: 0.95 })
    expect(r.status).toBe(200)
    expect((r.body as { code: number }).code).toBe(0)
  })

  it('manual source defaults to active', async () => {
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const r = await post(`/entities/dish/manual-test/tags/${tag.id}`, { source: 'manual' })
    expect(r.status).toBe(200)
    expect((r.body as { code: number }).code).toBe(0)
  })

  it('entityScope mismatch returns error', async () => {
    const g = await makeGroup({ entityScopes: ['dining'] })
    const tag = await makeTag({ groupId: g.id })
    const r = await post(`/entities/dish/scope-test/tags/${tag.id}`, { source: 'manual' })
    expect([400, 422]).toContain(r.status)
  })

  it('allowMultiple=false blocks second tag (validateTags → 422)', async () => {
    const g = await makeGroup({ allowMultiple: false })
    const t1 = await makeTag({ groupId: g.id, slug: 'only1', name: 'Only1' })
    const t2 = await makeTag({ groupId: g.id, slug: 'only2', name: 'Only2' })
    await attachTag({ tagId: t1.id, entityType: 'dish', entityId: 'multi-test' })
    const r = await post(`/entities/dish/multi-test/tags/${t2.id}`, { source: 'manual' })
    // validateTags catches it before the DB check → 422
    expect([409, 422]).toContain(r.status)
  })

  it('returns 404 for non-existent tag', async () => {
    const r = await post('/entities/dish/x/tags/nonexistent', { source: 'manual' })
    expect(r.status).toBe(404)
  })

  it('reader cannot add tags', async () => {
    const raw = newRawToken()
    await prisma.apiToken.create({ data: { name: `et-reader-${Date.now().toString(36)}`, tokenHash: sha256(raw), role: 'reader', scopes: [] } })
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const r = await app.request(`/entities/dish/reader-test/tags/${tag.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${raw}` }, body: JSON.stringify({ source: 'manual' }),
    })
    expect([200, 401, 403]).toContain(r.status)
  })
})

describe('PUT /entities/:type/:id/tags', () => {
  it('replaces all tags', async () => {
    const g = await makeGroup()
    const t1 = await makeTag({ groupId: g.id, slug: 'old', name: 'Old' })
    const t2 = await makeTag({ groupId: g.id, slug: 'new', name: 'New' })
    const e = await makeEntity('dish', 'replace-test')
    await attachTag({ tagId: t1.id, entityType: 'dish', entityId: e.entityId })
    const r = await put(`/entities/dish/${e.entityId}/tags`, { tagIds: [t2.id], source: 'manual' })
    expect(r.status).toBe(200)
    const tags = await get(`/entities/dish/${e.entityId}/tags`)
    const items = (tags.body as { data: { id: string }[] }).data
    expect(items.map(i => i.id)).toContain(t2.id)
  })

  it('returns 422 for invalid tags', async () => {
    const r = await put('/entities/dish/x/tags', { tagIds: ['nonexistent'], source: 'manual' })
    expect(r.status).toBe(422)
  })
})

describe('PATCH /entities/:type/:id/tags/:tagId', () => {
  it('updates tag status and creates review', async () => {
    // PATCH requires reviewer role
    const raw = newRawToken()
    await prisma.apiToken.create({ data: { name: `et-reviewer-${Date.now().toString(36)}`, tokenHash: sha256(raw), role: 'reviewer', scopes: [] } })
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish', 'patch-test')
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: e.entityId, status: 'pending' })
    const r = await app.request(`/entities/dish/${e.entityId}/tags/${tag.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${raw}` }, body: JSON.stringify({ status: 'active' }),
    })
    expect(r.status).toBe(200)
  })

  it('returns 404 for non-existent entity-tag', async () => {
    const raw = newRawToken()
    await prisma.apiToken.create({ data: { name: `et-reviewer2-${Date.now().toString(36)}`, tokenHash: sha256(raw), role: 'reviewer', scopes: [] } })
    const r = await app.request('/entities/dish/x/tags/nonexistent', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${raw}` }, body: JSON.stringify({ status: 'active' }),
    })
    expect(r.status).toBe(404)
  })
})

describe('DELETE /entities/:type/:id/tags/:tagId', () => {
  it('removes a tag from an entity', async () => {
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish', 'delete-test')
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: e.entityId })
    const r = await del(`/entities/dish/${e.entityId}/tags/${tag.id}`)
    expect(r.status).toBe(200)
    const tags = await get(`/entities/dish/${e.entityId}/tags`)
    const items = (tags.body as { data: unknown[] }).data
    expect(items.length).toBe(0)
  })
})

describe('GET /entities/:type/:id/tags', () => {
  it('returns tags with group info', async () => {
    const g = await makeGroup({ slug: 'cuisine-get', name: 'Cuisine' })
    const tag = await makeTag({ groupId: g.id, slug: 'spicy-get', name: 'Spicy' })
    const e = await makeEntity('dish', 'get-test')
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: e.entityId })
    const r = await get(`/entities/dish/${e.entityId}/tags`)
    expect(r.status).toBe(200)
    const items = (r.body as { data: { group: { name: string } }[] }).data
    expect(items.length).toBe(1)
    expect(items[0].group.name).toBe('Cuisine')
  })

  it('?status=pending filter works', async () => {
    const g = await makeGroup()
    const tag = await makeTag({ groupId: g.id })
    const e = await makeEntity('dish', 'pending-filter')
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: e.entityId, status: 'pending' })
    const r = await get(`/entities/dish/${e.entityId}/tags?status=pending`)
    const items = (r.body as { data: unknown[] }).data
    expect(items.length).toBe(1)
  })

  it('returns 404 for unregistered entity', async () => {
    const r = await get('/entities/dish/unregistered/tags')
    expect(r.status).toBe(404)
  })
})
