/**
 * 角色权限测试。
 *
 * 覆盖：
 *   - 无 token → 401
 *   - 错误 token → 403
 *   - 已撤销 token → 403
 *   - reader：GET 正常，POST/PATCH/DELETE → 403
 *   - writer：打标正常，审核 → 403，admin 操作 → 403
 *   - reviewer：审核正常，admin 操作 → 403
 *   - admin：全通
 *   - env API_TOKEN fallback → admin 权限
 */

import { createHash, randomBytes } from 'crypto'
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity, attachTag } from './helpers.js'

// ── 工具 ───────────────────────────────────────────────────────────

function sha256(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

function rawToken() {
  return 'ct_' + randomBytes(16).toString('hex')
}

async function makeToken(role: 'reader' | 'writer' | 'reviewer' | 'admin') {
  const raw  = rawToken()
  await prisma.apiToken.create({
    data: { name: `test-${role}`, tokenHash: sha256(raw), role, scopes: [] },
  })
  return raw
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

let app: ReturnType<typeof buildApp>
let savedEnvToken: string | undefined

beforeAll(() => {
  // 强制设置 API_TOKEN，让 bearerAuth 切换到真实鉴权模式
  savedEnvToken = process.env.API_TOKEN
  process.env.API_TOKEN = rawToken()
  app = buildApp({ silent: true })
})

afterEach(async () => {
  await prisma.apiToken.deleteMany()
})

// 还原 env，避免污染其他测试文件
afterAll(async () => {
  await prisma.apiToken.deleteMany()
  if (savedEnvToken !== undefined) {
    process.env.API_TOKEN = savedEnvToken
  } else {
    delete process.env.API_TOKEN
  }
})

// ── 基础认证 ───────────────────────────────────────────────────────

describe('基础认证', () => {
  it('无 Authorization header → 401', async () => {
    const res = await app.request('/tag-groups')
    expect(res.status).toBe(401)
  })

  it('错误 token → 403', async () => {
    const res = await app.request('/tag-groups', { headers: bearer('wrong-token') })
    expect(res.status).toBe(403)
  })

  it('已撤销 token → 403', async () => {
    const raw = await makeToken('admin')
    await prisma.apiToken.updateMany({ where: {}, data: { revokedAt: new Date() } })
    const res = await app.request('/tag-groups', { headers: bearer(raw) })
    expect(res.status).toBe(403)
  })

  it('env API_TOKEN → admin 权限', async () => {
    const envToken = process.env.API_TOKEN!
    const res = await app.request('/tag-groups', { headers: bearer(envToken) })
    expect(res.status).toBe(200)
  })
})

// ── reader 角色 ────────────────────────────────────────────────────

describe('reader 角色', () => {
  it('GET /tag-groups → 200', async () => {
    const raw = await makeToken('reader')
    expect((await app.request('/tag-groups', { headers: bearer(raw) })).status).toBe(200)
  })

  it('POST /tag-groups → 403', async () => {
    const raw = await makeToken('reader')
    const res = await app.request('/tag-groups', {
      method: 'POST',
      headers: { ...bearer(raw), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'X' }),
    })
    expect(res.status).toBe(403)
  })

  it('GET /entities/audit → 403', async () => {
    const raw = await makeToken('reader')
    expect((await app.request('/entities/audit', { headers: bearer(raw) })).status).toBe(403)
  })
})

// ── writer 角色 ────────────────────────────────────────────────────

describe('writer 角色', () => {
  it('POST /entities/:type/:id (注册) → 200', async () => {
    const raw = await makeToken('writer')
    const res = await app.request('/entities/dish/writer-test-entity', {
      method: 'POST',
      headers: bearer(raw),
    })
    expect(res.status).toBe(200)
  })

  it('POST /tag-groups → 403', async () => {
    const raw = await makeToken('writer')
    const res = await app.request('/tag-groups', {
      method: 'POST',
      headers: { ...bearer(raw), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'X' }),
    })
    expect(res.status).toBe(403)
  })

  it('PATCH tag status (审核) → 403', async () => {
    const raw   = await makeToken('writer')
    const group = await makeGroup()
    const tag   = await makeTag({ groupId: group.id })
    const entity = await makeEntity('dish')
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: entity.entityId, source: 'ai', status: 'pending' })

    const res = await app.request(`/entities/dish/${entity.entityId}/tags/${tag.id}`, {
      method: 'PATCH',
      headers: { ...bearer(raw), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(403)
  })

  it('GET /entities/audit → 403', async () => {
    const raw = await makeToken('writer')
    expect((await app.request('/entities/audit', { headers: bearer(raw) })).status).toBe(403)
  })
})

// ── reviewer 角色 ──────────────────────────────────────────────────

describe('reviewer 角色', () => {
  it('GET /entities/audit → 200', async () => {
    const raw = await makeToken('reviewer')
    expect((await app.request('/entities/audit', { headers: bearer(raw) })).status).toBe(200)
  })

  it('PATCH tag status → 200', async () => {
    const raw    = await makeToken('reviewer')
    const group  = await makeGroup()
    const tag    = await makeTag({ groupId: group.id })
    const entity = await makeEntity('dish')
    await attachTag({ tagId: tag.id, entityType: 'dish', entityId: entity.entityId, source: 'ai', status: 'pending' })

    const res = await app.request(`/entities/dish/${entity.entityId}/tags/${tag.id}`, {
      method: 'PATCH',
      headers: { ...bearer(raw), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(200)
  })

  it('POST /tag-groups → 403', async () => {
    const raw = await makeToken('reviewer')
    const res = await app.request('/tag-groups', {
      method: 'POST',
      headers: { ...bearer(raw), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'X' }),
    })
    expect(res.status).toBe(403)
  })
})

// ── admin 角色 ────────────────────────────────────────────────────

describe('admin 角色', () => {
  it('POST /tag-groups → 200', async () => {
    const raw = await makeToken('admin')
    const res = await app.request('/tag-groups', {
      method: 'POST',
      headers: { ...bearer(raw), 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: `admin-test-${Date.now()}`, name: `Admin Test ${Date.now()}` }),
    })
    expect(res.status).toBe(200)
  })

  it('GET /tokens (token 列表) → 200', async () => {
    const raw = await makeToken('admin')
    expect((await app.request('/tokens', { headers: bearer(raw) })).status).toBe(200)
  })

  it('reader token 访问 /tokens → 403', async () => {
    const raw = await makeToken('reader')
    expect((await app.request('/tokens', { headers: bearer(raw) })).status).toBe(403)
  })
})
