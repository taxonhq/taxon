/**
 * P0: Webhook SSRF 防护回归防线 (#147)
 *
 * 验证 webhook 投递时不会跟随 HTTP 重定向（redirect: 'manual'），
 * 防止攻击者通过 3xx 重定向绕过 SSRF 校验访问内网资源。
 *
 * deliverOne(delivery, webhook, fetchImpl) → Promise<boolean>
 */
import { createHash, randomBytes } from 'crypto'
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma } from './helpers.js'
import { deliverOne } from '../src/lib/webhook-worker.js'

function sha256(raw: string) { return createHash('sha256').update(raw).digest('hex') }
function rawToken() { return 'ct_' + randomBytes(16).toString('hex') }

async function makeToken(role: 'admin') {
  const raw = rawToken()
  await prisma.apiToken.create({ data: { name: `ssrf-${role}-${Date.now().toString(36)}`, tokenHash: sha256(raw), role, scopes: [] } })
  return raw
}

let app: ReturnType<typeof buildApp>
let adminToken: string
const savedFetch = globalThis.fetch

beforeAll(async () => {
  app = buildApp({ silent: true })
  adminToken = await makeToken('admin')
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  globalThis.fetch = savedFetch
})

// ── helpers ────────────────────────────────────────────────────────

async function createWebhookDelivery() {
  const secret = 'test-ssrf-secret'
  const wh = await prisma.webhook.create({
    data: {
      name: `ssrf-test-${Date.now().toString(36)}`,
      url: 'https://safe-looking.example.com/webhook',
      secret,
      events: ['tag.created'],
      scopes: [],
    },
  })
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId: wh.id,
      event: 'tag.created',
      payload: { tagId: 'test-tag' },
    },
  })
  // Re-fetch with createdAt
  const full = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })
  return { delivery: full!, webhook: { url: wh.url, secret: wh.secret } }
}

// ── WK-01: 302 → 169.254.169.254 → 投递失败 ──────────────────────
describe('WK-01: 302 redirect to cloud metadata endpoint blocked', () => {
  it('deliverOne should fail when endpoint returns 302 to 169.254.169.254', async () => {
    const { delivery, webhook } = await createWebhookDelivery()

    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data/' }),
      text: async () => '',
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await deliverOne(delivery, webhook, mockFetch as unknown as typeof fetch)
    const updated = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })
    expect(updated).not.toBeNull()

    const respBody = updated!.responseBody ?? ''
    expect(respBody).toContain('redirect blocked')
    expect(respBody).toContain('SSRF guard')
    expect(updated!.responseCode).toBe(302)
  })
})

// ── WK-02: 301 → 内网 10.0.0.1 → 投递失败 ─────────────────────────
describe('WK-02: 301 redirect to internal network blocked', () => {
  it('deliverOne should fail when endpoint returns 301 to 10.0.0.1', async () => {
    const { delivery, webhook } = await createWebhookDelivery()

    const mockFetch = vi.fn().mockResolvedValue({
      status: 301,
      headers: new Headers({ location: 'http://10.0.0.1/admin' }),
      text: async () => '',
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    await deliverOne(delivery, webhook, mockFetch as unknown as typeof fetch)
    const updated = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })
    expect(updated).not.toBeNull()
    expect(updated!.responseBody).toContain('redirect blocked')
    expect(updated!.responseBody).toContain('SSRF guard')
  })
})

// ── WK-03: 正常 200 响应 → 投递成功 ────────────────────────────────
describe('WK-03: normal 200 response succeeds', () => {
  it('deliverOne succeeds with normal 200 response', async () => {
    const { delivery, webhook } = await createWebhookDelivery()

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'OK',
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const ok = await deliverOne(delivery, webhook, mockFetch as unknown as typeof fetch)
    expect(ok).toBe(true)

    const updated = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('success')
    expect(updated!.responseCode).toBe(200)
  })
})

// ── WK-04: 正常 201 响应 → 投递成功 ────────────────────────────────
describe('WK-04: normal 201 response succeeds', () => {
  it('deliverOne succeeds with 201 Created', async () => {
    const { delivery, webhook } = await createWebhookDelivery()

    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      text: async () => 'Created',
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const ok = await deliverOne(delivery, webhook, mockFetch as unknown as typeof fetch)
    expect(ok).toBe(true)

    const updated = await prisma.webhookDelivery.findUnique({ where: { id: delivery.id } })
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('success')
    expect(updated!.responseCode).toBe(201)
  })
})

// ── WK-05: 注册 webhook 时 SSRF 校验拦截内网地址 ──────────────────
describe('WK-05: SSRF validation on webhook registration', () => {
  function bearer(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` }
  }

  it('creating webhook with 127.0.0.1 URL should fail', async () => {
    const r = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(adminToken) },
      body: JSON.stringify({
        name: 'localhost-webhook',
        url: 'http://127.0.0.1:8080/webhook',
        events: ['tag.created'],
        secret: 'test-secret-ssrf-localhost',
      }),
    })
    // Should reject internal addresses (either 400 or 422)
    expect([400, 422]).toContain(r.status)
  })

  it('creating webhook with 10.x.x.x URL should fail', async () => {
    const r = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(adminToken) },
      body: JSON.stringify({
        name: 'internal-webhook',
        url: 'http://10.0.0.1:8080/webhook',
        events: ['tag.created'],
        secret: 'test-secret-ssrf-internal',
      }),
    })
    expect([400, 422]).toContain(r.status)
  })
})
