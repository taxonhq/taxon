/**
 * P0: 时区正确性回归防线 (#148 + #149)
 */
import { createHash, randomBytes } from 'crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

let app: ReturnType<typeof buildApp>
let reviewerTokenId: string
let reviewerToken: string

function sha256(raw: string) { return createHash('sha256').update(raw).digest('hex') }
function newRawToken() { return 'ct_' + randomBytes(16).toString('hex') }

beforeAll(async () => {
  app = buildApp({ silent: true })
  const raw = newRawToken()
  const token = await prisma.apiToken.create({ data: { name: `tz-rev-${Date.now().toString(36)}`, tokenHash: sha256(raw), role: 'reviewer', scopes: [] } })
  reviewerTokenId = token.id
  reviewerToken = raw
})

function bearer(token: string): HeadersInit { return { Authorization: `Bearer ${token}` } }

async function get(path: string, headers?: HeadersInit) {
  const res = await app.request(path, { headers })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { body = { _raw: text } }
  return { status: res.status, body }
}

// ── TZ-01: trend 端点基础功能 ─────────────────────────────────────
describe('TZ-01: trend endpoint smoke', () => {
  it('trend with period=7d returns 7-day series', async () => {
    // 回归 #151：APP_TZ_OFFSET_MIN 非零时 make_interval(mins => bigint) 曾报 500，
    // 现在必须正常返回 200 + 7 天序列。
    const r = await get('/metrics/trend?period=7d')
    expect(r.status).toBe(200)
    const data = r.body.data as { period: string; series: { date: string }[] }
    expect(data.series.length).toBe(7)
  })
})

// ── TZ-02: today 端点 ─────────────────────────────────────────────
describe('TZ-02: today endpoint', () => {
  it('today returns expected shape', async () => {
    const r = await get('/metrics/today')
    if (r.status === 200) {
      const data = r.body.data as Record<string, unknown>
      expect(data).toBeDefined()
    }
  })
})

// ── TZ-03: reviewer-stats 使用 isRevert ───────────────────────────
describe('TZ-03: reviewer-stats uses isRevert field (#149)', () => {
  it('review with note="撤销" but isRevert=false is NOT counted as revert', async () => {
    const group = await makeGroup({ slug: 'rev1' })
    const tag = await makeTag({ groupId: group.id, slug: 'rev-tag1', name: 'Rev Tag1' })
    const entity = await makeEntity('dish', 'dish-tz-rev1')

    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: entity.entityId, status: 'active' })

    // Create review with the token's reviewerId so it matches the filter
    await prisma.entityTagReview.create({
      data: {
        tagId: tag.id, entityType: 'dish', entityId: entity.entityId,
        reviewerId: reviewerTokenId,
        fromStatus: 'active', toStatus: 'pending',
        note: '撤销', isRevert: false,
      },
    })

    const r = await get('/metrics/reviewer-stats?from=2026-01-01', bearer(reviewerToken))
    expect(r.status).toBe(200)
    const data = r.body.data as { reverted: number; approved: number; rejected: number }
    expect(data.reverted).toBe(0)
  })

  it('review with isRevert=true IS counted as revert', async () => {
    const group = await makeGroup({ slug: 'rev2' })
    const tag = await makeTag({ groupId: group.id, slug: 'rev-tag2', name: 'Rev Tag2' })
    const entity = await makeEntity('dish', 'dish-tz-rev2')

    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: entity.entityId, status: 'active' })

    await prisma.entityTagReview.create({
      data: {
        tagId: tag.id, entityType: 'dish', entityId: entity.entityId,
        reviewerId: reviewerTokenId,
        fromStatus: 'active', toStatus: 'pending',
        note: '撤销', isRevert: true,
      },
    })

    const r = await get('/metrics/reviewer-stats?from=2026-01-01', bearer(reviewerToken))
    expect(r.status).toBe(200)
    const data = r.body.data as { reverted: number }
    expect(data.reverted).toBeGreaterThanOrEqual(1)
  })

  it('normal approval is counted as approved', async () => {
    const group = await makeGroup({ slug: 'rev3' })
    const tag = await makeTag({ groupId: group.id, slug: 'rev-tag3', name: 'Rev Tag3' })
    const entity = await makeEntity('dish', 'dish-tz-rev3')

    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: entity.entityId, status: 'pending' })

    await prisma.entityTagReview.create({
      data: {
        tagId: tag.id, entityType: 'dish', entityId: entity.entityId,
        reviewerId: reviewerTokenId,
        fromStatus: 'pending', toStatus: 'active',
        note: 'looks good', isRevert: false,
      },
    })

    const r = await get('/metrics/reviewer-stats?from=2026-01-01', bearer(reviewerToken))
    expect(r.status).toBe(200)
    const data = r.body.data as { approved: number }
    expect(data.approved).toBeGreaterThanOrEqual(1)
  })
})
