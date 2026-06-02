/**
 * Webhook 子系统测试（#34）。
 *
 * 覆盖：
 *   - HMAC 签名正确性 + 防篡改
 *   - Webhook CRUD（admin 鉴权、secret 一次性返回 + 列表脱敏、404、非 admin 403）
 *   - 事件发射：PATCH 审核状态 → outbox 写入 entity_tag.status_changed
 *   - outbox fan-out → 投递（mock fetch 2xx → success + lastFiredAt）
 *   - scope 过滤：scopes=['dish'] 不收 dining 事件
 *   - 重试：5xx → attempts++ / nextRetryAt 重排 / 多次后 failed
 *   - replay：重排 failed 投递为 pending
 */
import { createHash, randomBytes, createHmac } from 'node:crypto'
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, attachTag } from './helpers.js'
import {
  signBody, buildDeliveryBody, fanOutOnce, deliverPendingOnce, processOutboxOnce, MAX_ATTEMPTS,
} from '../src/lib/webhook-worker.js'
import { TagSource, TagStatus } from '@prisma/client'

function sha256(raw: string) { return createHash('sha256').update(raw).digest('hex') }
function rawToken() { return 'ct_' + randomBytes(16).toString('hex') }
function bearer(token: string): HeadersInit { return { Authorization: `Bearer ${token}` } }

async function makeToken(role: 'reader' | 'writer' | 'reviewer' | 'admin') {
  const raw = rawToken()
  await prisma.apiToken.create({ data: { name: `wh-${role}`, tokenHash: sha256(raw), role, scopes: [] } })
  return raw
}

async function makeWebhook(over: Partial<{ url: string; events: string[]; scopes: string[]; secret: string; active: boolean }> = {}) {
  return prisma.webhook.create({
    data: {
      name: 'test-hook',
      url: over.url ?? 'https://example.test/hook',
      secret: over.secret ?? 'whsec_test',
      events: over.events ?? ['entity_tag.status_changed'],
      scopes: over.scopes ?? [],
      active: over.active ?? true,
    },
  })
}

let app: ReturnType<typeof buildApp>
let savedEnvToken: string | undefined

beforeAll(() => {
  savedEnvToken = process.env.API_TOKEN
  process.env.API_TOKEN = rawToken()
  app = buildApp({ silent: true })
})

afterEach(async () => {
  await prisma.apiToken.deleteMany()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await prisma.apiToken.deleteMany()
  if (savedEnvToken !== undefined) process.env.API_TOKEN = savedEnvToken
  else delete process.env.API_TOKEN
})

// ── 签名 ──────────────────────────────────────────────────────────
describe('HMAC 签名', () => {
  it('格式为 sha256=<hex>，且与标准 HMAC 一致', () => {
    const body = '{"hello":"world"}'
    const sig = signBody('secret123', body)
    const expected = 'sha256=' + createHmac('sha256', 'secret123').update(body).digest('hex')
    expect(sig).toBe(expected)
  })

  it('body 篡改后签名不同', () => {
    expect(signBody('s', '{"a":1}')).not.toBe(signBody('s', '{"a":2}'))
  })
})

// ── CRUD ─────────────────────────────────────────────────────────
describe('Webhook CRUD', () => {
  it('创建返回完整 secret，列表脱敏', async () => {
    const admin = await makeToken('admin')
    const createRes = await app.request('/webhooks', {
      method: 'POST', headers: { ...bearer(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'h1', url: 'https://e.test/x', events: ['entity_tag.created'] }),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.code).toBe(0)
    expect(created.data.secret).toMatch(/^whsec_/)          // 完整 secret 仅此一次
    expect(created.data.secretMask).toContain('…')

    const listRes = await app.request('/webhooks', { headers: bearer(admin) })
    const list = await listRes.json()
    expect(list.data).toHaveLength(1)
    expect(list.data[0].secret).toBeUndefined()             // 列表不含完整 secret
    expect(list.data[0].secretMask).toContain('…')
  })

  it('非法事件名 → 422', async () => {
    const admin = await makeToken('admin')
    const res = await app.request('/webhooks', {
      method: 'POST', headers: { ...bearer(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'h', url: 'https://e.test/x', events: ['nonsense.event'] }),
    })
    expect(res.status).toBe(422)
  })

  it('非 admin → 403', async () => {
    const writer = await makeToken('writer')
    const res = await app.request('/webhooks', { headers: bearer(writer) })
    expect(res.status).toBe(403)
  })

  it('PATCH 更新 + DELETE + 404', async () => {
    const admin = await makeToken('admin')
    const w = await makeWebhook()
    const patch = await app.request(`/webhooks/${w.id}`, {
      method: 'PATCH', headers: { ...bearer(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    })
    expect(patch.status).toBe(200)
    expect((await patch.json()).data.active).toBe(false)

    const del = await app.request(`/webhooks/${w.id}`, { method: 'DELETE', headers: bearer(admin) })
    expect(del.status).toBe(200)

    const missing = await app.request(`/webhooks/${w.id}`, { headers: bearer(admin) })
    expect(missing.status).toBe(404)
  })
})

// ── 事件发射 ──────────────────────────────────────────────────────
describe('事件发射 → outbox', () => {
  it('PATCH 审核状态写入 entity_tag.status_changed', async () => {
    const reviewer = await makeToken('reviewer')
    const group = await makeGroup()
    const tag = await makeTag({ groupId: group.id })
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: 'e1', source: TagSource.ai, status: TagStatus.pending, confidence: 0.9 })

    const res = await app.request('/entities/dish/e1/tags/' + tag.id, {
      method: 'PATCH', headers: { ...bearer(reviewer), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected', note: 'bad' }),
    })
    expect(res.status).toBe(200)

    const events = await prisma.eventOutbox.findMany({ where: { event: 'entity_tag.status_changed' } })
    expect(events).toHaveLength(1)
    const payload = events[0].payload as Record<string, unknown>
    expect(payload.entityType).toBe('dish')
    expect(payload.tagId).toBe(tag.id)
    expect(payload.status).toBe('rejected')
    expect(payload.previousStatus).toBe('pending')
  })
})

// ── 投递 ──────────────────────────────────────────────────────────
describe('outbox 投递', () => {
  it('fan-out + 2xx 投递 → success + 更新 lastFiredAt + 签名头', async () => {
    const w = await makeWebhook({ events: ['entity_tag.created'] })
    await prisma.eventOutbox.create({ data: { event: 'entity_tag.created', payload: { entityType: 'dish', entityId: 'e1', tagId: 't1' } } })

    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    const r = await processOutboxOnce(fetchMock as unknown as typeof fetch)
    expect(r.fannedOut).toBe(1)
    expect(r.delivered).toBe(1)

    // 校验请求头与签名
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(w.url)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Taxon-Event']).toBe('entity_tag.created')
    expect(headers['X-Taxon-Signature']).toBe(signBody(w.secret, init.body as string))

    const deliveries = await prisma.webhookDelivery.findMany()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].status).toBe('success')
    expect(deliveries[0].deliveredAt).not.toBeNull()

    const fresh = await prisma.webhook.findUnique({ where: { id: w.id } })
    expect(fresh!.lastFiredAt).not.toBeNull()

    // outbox 已标记发布，二次跑不重复 fan-out
    const r2 = await processOutboxOnce(fetchMock as unknown as typeof fetch)
    expect(r2.fannedOut).toBe(0)
  })

  it('scope 过滤：scopes=[dish] 不收 dining 事件', async () => {
    await makeWebhook({ events: ['entity_tag.created'], scopes: ['dish'] })
    await prisma.eventOutbox.create({ data: { event: 'entity_tag.created', payload: { entityType: 'dining', entityId: 'd1', tagId: 't1' } } })

    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    const r = await processOutboxOnce(fetchMock as unknown as typeof fetch)
    expect(r.fannedOut).toBe(0)               // 不匹配 → 不 fan-out
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await prisma.webhookDelivery.count()).toBe(0)
  })

  it('5xx → 重试重排（pending + attempts++ + nextRetryAt）', async () => {
    await makeWebhook({ events: ['entity_tag.created'] })
    await prisma.eventOutbox.create({ data: { event: 'entity_tag.created', payload: { entityType: 'dish', entityId: 'e1', tagId: 't1' } } })

    const fetchMock = vi.fn(async () => new Response('boom', { status: 503 }))
    const r = await processOutboxOnce(fetchMock as unknown as typeof fetch)
    expect(r.delivered).toBe(0)
    expect(r.failed).toBe(1)

    const d = (await prisma.webhookDelivery.findMany())[0]
    expect(d.status).toBe('pending')          // 未耗尽 → 仍可重试
    expect(d.attempts).toBe(1)
    expect(d.responseCode).toBe(503)
    expect(d.nextRetryAt).not.toBeNull()
  })

  it('耗尽重试次数 → failed', async () => {
    const w = await makeWebhook({ events: ['entity_tag.created'] })
    // 直接造一条已尝试 MAX_ATTEMPTS-1 次的到期投递
    const d = await prisma.webhookDelivery.create({
      data: { webhookId: w.id, event: 'entity_tag.created', payload: { entityType: 'dish' }, status: 'pending', attempts: MAX_ATTEMPTS - 1, nextRetryAt: new Date() },
    })
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    await deliverPendingOnce(fetchMock as unknown as typeof fetch)

    const fresh = await prisma.webhookDelivery.findUnique({ where: { id: d.id } })
    expect(fresh!.attempts).toBe(MAX_ATTEMPTS)
    expect(fresh!.status).toBe('failed')      // 判死
    expect(fresh!.nextRetryAt).toBeNull()
  })
})

// ── replay ───────────────────────────────────────────────────────
describe('replay', () => {
  it('重放 failed 投递 → 重排 pending 后可成功', async () => {
    const admin = await makeToken('admin')
    const w = await makeWebhook({ events: ['entity_tag.created'] })
    const d = await prisma.webhookDelivery.create({
      data: { webhookId: w.id, event: 'entity_tag.created', payload: { entityType: 'dish' }, status: 'failed', attempts: MAX_ATTEMPTS, nextRetryAt: null, responseCode: 500 },
    })

    const replay = await app.request(`/webhooks/${w.id}/deliveries/${d.id}/replay`, { method: 'POST', headers: bearer(admin) })
    expect(replay.status).toBe(200)

    const reset = await prisma.webhookDelivery.findUnique({ where: { id: d.id } })
    expect(reset!.status).toBe('pending')
    expect(reset!.attempts).toBe(0)

    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    await deliverPendingOnce(fetchMock as unknown as typeof fetch)
    const done = await prisma.webhookDelivery.findUnique({ where: { id: d.id } })
    expect(done!.status).toBe('success')
  })
})

// fanOutOnce 直接单测（无 webhook 时不报错）
describe('fanOutOnce 边界', () => {
  it('无 webhook 时仍标记 outbox 已发布', async () => {
    await prisma.eventOutbox.create({ data: { event: 'tag.created', payload: { tagId: 't1' } } })
    const created = await fanOutOnce()
    expect(created).toBe(0)
    const ev = (await prisma.eventOutbox.findMany())[0]
    expect(ev.publishedAt).not.toBeNull()      // 已发布，不会反复处理
  })
})
