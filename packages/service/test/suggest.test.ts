/**
 * Tests for POST /entities/:type/:id/suggest — AI tag suggestion API (#33).
 *
 * LLM 层通过 vi.mock 替换，不发出真实网络请求：
 *   - buildProvider → 返回 mockProvider（可在每个 it 里重新配置）
 *   - loadActiveLlmConfig → 返回固定 fake 配置
 *
 * 验证的行为：
 *   - 未注册实体 → 404
 *   - LLM 未配置 → 503
 *   - 正常路径：返回 suggestions，包含 tagId/confidence/reasoning
 *   - topK / minConfidence 过滤正确
 *   - apply=true 写入 pending EntityTag
 *   - LLM 返回不存在的 tagId → 自动过滤掉
 *   - 指定不存在的 groups → 404
 */

import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { prisma, makeGroup, makeTag, makeEntity } from './helpers.js'

// ── Mock LLM 模块 ───────────────────────────────────────────────────────────
// vi.mock 会提升到文件顶部（hoisting），在 buildApp 实例化之前生效。

const mockCall = vi.fn()

vi.mock('../src/lib/llm/index.js', () => ({
  buildProvider: vi.fn(() => ({
    name: 'anthropic' as const,
    call: mockCall,
    callPlain: vi.fn(),
  })),
  LlmError: class LlmError extends Error {
    constructor(msg: string, public cause?: unknown) { super(msg); this.name = 'LlmError' }
  },
}))

vi.mock('../src/lib/load-llm-config.js', () => ({
  loadActiveLlmConfig: vi.fn(async () => ({
    provider: 'anthropic' as const,
    model:    'claude-3-haiku-20240307',
    apiKey:   'sk-test-key',
  })),
}))

// ── Test setup ───────────────────────────────────────────────────────────────

let app: ReturnType<typeof buildApp>
beforeAll(() => { app = buildApp({ silent: true }) })

afterEach(() => { vi.clearAllMocks() })

async function suggest(
  entityType: string,
  entityId: string,
  body: Record<string, unknown> = {},
) {
  return app.request(`/entities/${entityType}/${entityId}/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /entities/:type/:id/suggest', () => {
  it('returns 404 for unregistered entity', async () => {
    const res = await suggest('dish', 'nonexistent-entity-id')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe(404)
  })

  it('returns 503 when LLM config is not set (fail-fast before entity check)', async () => {
    const { loadActiveLlmConfig } = await import('../src/lib/load-llm-config.js')
    vi.mocked(loadActiveLlmConfig).mockResolvedValueOnce(null)

    // LLM 配置检查在实体检查之前，所以即使实体不存在也会先返回 503
    const res = await suggest('dish', 'any-entity-id')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe(503)
  })

  it('returns suggestions with tag metadata', async () => {
    const group = await makeGroup({ slug: 'cuisine', name: '菜系' })
    const tag   = await makeTag({ groupId: group.id, slug: 'sichuan', name: '川菜' })
    const entity = await makeEntity('dish')

    mockCall.mockResolvedValueOnce({
      output: {
        suggestions: [
          { tagId: tag.id, confidence: 0.92, reasoning: '典型川菜风格' },
        ],
      },
      text:  '',
      model: 'anthropic/claude-3-haiku-20240307',
    })

    const res = await suggest(entity.entityType, entity.entityId, {
      context: { name: '宫保鸡丁', description: '经典川菜' },
    })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { suggestions: unknown[]; model: string } }
    expect(data.suggestions).toHaveLength(1)
    const s = data.suggestions[0] as Record<string, unknown>
    expect(s.tagId).toBe(tag.id)
    expect(s.tagSlug).toBe('sichuan')
    expect(s.tagName).toBe('川菜')
    expect(s.groupSlug).toBe('cuisine')
    expect(s.confidence).toBe(0.92)
    expect(s.reasoning).toBe('典型川菜风格')
    expect(data.model).toMatch(/anthropic/)
  })

  it('filters by minConfidence', async () => {
    const group  = await makeGroup({ slug: 'diet', name: '饮食' })
    const tagA   = await makeTag({ groupId: group.id, slug: 'vegan', name: '素食' })
    const tagB   = await makeTag({ groupId: group.id, slug: 'spicy', name: '辣' })
    const entity = await makeEntity('dish')

    mockCall.mockResolvedValueOnce({
      output: {
        suggestions: [
          { tagId: tagA.id, confidence: 0.9, reasoning: '高置信' },
          { tagId: tagB.id, confidence: 0.3, reasoning: '低置信' },
        ],
      },
      text:  '',
      model: 'anthropic/claude-3-haiku-20240307',
    })

    const res = await suggest(entity.entityType, entity.entityId, { minConfidence: 0.5 })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { suggestions: unknown[] } }
    // 只有 0.9 >= 0.5 的那条
    expect(data.suggestions).toHaveLength(1)
    expect((data.suggestions[0] as Record<string, unknown>).tagSlug).toBe('vegan')
  })

  it('limits results by topK', async () => {
    const group  = await makeGroup({ slug: 'flavor', name: '口味' })
    const tags   = await Promise.all([
      makeTag({ groupId: group.id, slug: 'sweet',   name: '甜' }),
      makeTag({ groupId: group.id, slug: 'sour',    name: '酸' }),
      makeTag({ groupId: group.id, slug: 'bitter',  name: '苦' }),
    ])
    const entity = await makeEntity('dish')

    mockCall.mockResolvedValueOnce({
      output: {
        suggestions: tags.map((t, i) => ({
          tagId: t.id, confidence: 0.9 - i * 0.1, reasoning: `理由${i}`,
        })),
      },
      text:  '',
      model: 'anthropic/claude-3-haiku-20240307',
    })

    const res = await suggest(entity.entityType, entity.entityId, { topK: 2 })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { suggestions: unknown[] } }
    expect(data.suggestions).toHaveLength(2)
    // 应该是置信度最高的两条
    expect((data.suggestions[0] as Record<string, unknown>).confidence).toBe(0.9)
    expect((data.suggestions[1] as Record<string, unknown>).confidence).toBe(0.8)
  })

  it('silently drops LLM tagIds that are not in the available tag list', async () => {
    const group  = await makeGroup({ slug: 'style', name: '风格' })
    const tag    = await makeTag({ groupId: group.id, slug: 'modern', name: '现代' })
    const entity = await makeEntity('dish')

    mockCall.mockResolvedValueOnce({
      output: {
        suggestions: [
          { tagId: 'nonexistent-tag-id-xyz', confidence: 0.99, reasoning: '幽灵标签' },
          { tagId: tag.id,                   confidence: 0.85, reasoning: '真实标签' },
        ],
      },
      text:  '',
      model: 'anthropic/claude-3-haiku-20240307',
    })

    const res = await suggest(entity.entityType, entity.entityId)
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { suggestions: unknown[] } }
    // 幽灵 tagId 被过滤，只剩真实标签
    expect(data.suggestions).toHaveLength(1)
    expect((data.suggestions[0] as Record<string, unknown>).tagId).toBe(tag.id)
  })

  it('apply=true writes suggestions as pending EntityTags', async () => {
    const group  = await makeGroup({ slug: 'region', name: '地区' })
    const tag    = await makeTag({ groupId: group.id, slug: 'beijing', name: '北京' })
    const entity = await makeEntity('dish')

    mockCall.mockResolvedValueOnce({
      output: {
        suggestions: [
          { tagId: tag.id, confidence: 0.88, reasoning: '北京菜' },
        ],
      },
      text:  '',
      model: 'anthropic/claude-3-haiku-20240307',
    })

    const res = await suggest(entity.entityType, entity.entityId, { apply: true })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { appliedCount: number } }
    expect(data.appliedCount).toBe(1)

    // 验证数据库中已写入 pending EntityTag
    const written = await prisma.entityTag.findMany({
      where: {
        entityType: entity.entityType,
        entityId:   entity.entityId,
        status:     'pending',
        source:     'ai',
      },
    })
    expect(written).toHaveLength(1)
    expect(written[0].tagId).toBe(tag.id)
    expect(written[0].confidence).toBeCloseTo(0.88)
  })

  it('filters by groups slug', async () => {
    const groupA = await makeGroup({ slug: 'grp-a', name: 'A组' })
    const groupB = await makeGroup({ slug: 'grp-b', name: 'B组' })
    const tagA   = await makeTag({ groupId: groupA.id, slug: 'tag-a', name: 'A标签' })
    const tagB   = await makeTag({ groupId: groupB.id, slug: 'tag-b', name: 'B标签' })
    const entity = await makeEntity('dish')

    mockCall.mockResolvedValueOnce({
      output: {
        suggestions: [
          // LLM 可能推荐 B 组的标签，但我们只限定 A 组
          { tagId: tagB.id, confidence: 0.95, reasoning: '来自B组' },
          { tagId: tagA.id, confidence: 0.80, reasoning: '来自A组' },
        ],
      },
      text:  '',
      model: 'anthropic/claude-3-haiku-20240307',
    })

    const res = await suggest(entity.entityType, entity.entityId, { groups: ['grp-a'] })
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { suggestions: unknown[] } }
    // tagB 不在 grp-a 里，被过滤
    expect(data.suggestions).toHaveLength(1)
    expect((data.suggestions[0] as Record<string, unknown>).tagSlug).toBe('tag-a')
  })

  it('returns 404 for non-existent group slug in groups filter', async () => {
    const entity = await makeEntity('dish')
    const res = await suggest(entity.entityType, entity.entityId, {
      groups: ['definitely-does-not-exist'],
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe(404)
  })

  it('returns empty suggestions when no tags available (no error)', async () => {
    // 创建一个 entityScopes 限制为 restaurant 的分组，但实体类型是 dish
    await makeGroup({ slug: 'restaurant-only', name: '仅餐厅', entityScopes: ['restaurant'] })
    const entity = await makeEntity('dish')

    // 不需要 mockCall，因为不会调用 LLM（没有可用标签）
    const res = await suggest(entity.entityType, entity.entityId)
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { suggestions: unknown[] } }
    expect(data.suggestions).toHaveLength(0)
  })
})

// ── metadata 集成测试 ─────────────────────────────────────────────────────────

describe('RegisteredEntity metadata', () => {
  let app2: ReturnType<typeof buildApp>
  beforeAll(() => { app2 = buildApp({ silent: true }) })

  async function registerEntity(entityType: string, entityId: string, body: Record<string, unknown> = {}) {
    return app2.request(`/entities/${entityType}/${entityId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function patchEntity(entityType: string, entityId: string, body: Record<string, unknown>) {
    return app2.request(`/entities/${entityType}/${entityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function getEntity(entityType: string, entityId: string) {
    return app2.request(`/entities/${entityType}/${entityId}`)
  }

  it('POST /entities/:type/:id stores metadata', async () => {
    const res = await registerEntity('dish', 'dish-meta-001', {
      metadata: { name: '宫保鸡丁', description: '川菜，花生辣椒' },
    })
    expect(res.status).toBe(200)

    const get = await getEntity('dish', 'dish-meta-001')
    const { data } = await get.json() as { data: { metadata: Record<string, string> } }
    expect(data.metadata).toEqual({ name: '宫保鸡丁', description: '川菜，花生辣椒' })
  })

  it('POST without metadata leaves metadata null', async () => {
    await registerEntity('dish', 'dish-no-meta')
    const get = await getEntity('dish', 'dish-no-meta')
    const { data } = await get.json() as { data: { metadata: unknown } }
    expect(data.metadata).toBeNull()
  })

  it('POST idempotent: re-registering without metadata preserves existing metadata', async () => {
    await registerEntity('dish', 'dish-idem', { metadata: { name: '北京烤鸭' } })
    // 第二次不带 metadata
    await registerEntity('dish', 'dish-idem')
    const get = await getEntity('dish', 'dish-idem')
    const { data } = await get.json() as { data: { metadata: Record<string, string> } }
    expect(data.metadata?.name).toBe('北京烤鸭')
  })

  it('PATCH updates metadata', async () => {
    await registerEntity('dish', 'dish-patch', { metadata: { name: '旧名字' } })
    const patch = await patchEntity('dish', 'dish-patch', { metadata: { name: '新名字', description: '补充说明' } })
    expect(patch.status).toBe(200)

    const get = await getEntity('dish', 'dish-patch')
    const { data } = await get.json() as { data: { metadata: Record<string, string> } }
    expect(data.metadata).toEqual({ name: '新名字', description: '补充说明' })
  })

  it('PATCH with null metadata clears it', async () => {
    await registerEntity('dish', 'dish-clear', { metadata: { name: '有元数据' } })
    const patch = await patchEntity('dish', 'dish-clear', {})
    expect(patch.status).toBe(200)

    const get = await getEntity('dish', 'dish-clear')
    const { data } = await get.json() as { data: { metadata: unknown } }
    expect(data.metadata).toBeNull()
  })

  it('PATCH on non-existent entity returns 404', async () => {
    const res = await patchEntity('dish', 'ghost-entity', { metadata: { name: '幽灵' } })
    expect(res.status).toBe(404)
  })

  it('suggest uses entity metadata as context when no body context provided', async () => {
    const group  = await makeGroup({ slug: 'ctx-cuisine', name: '菜系' })
    const tag    = await makeTag({ groupId: group.id, slug: 'beijing', name: '北京菜' })

    // 注册时带入 metadata
    await registerEntity('dish', 'dish-with-meta', {
      metadata: { name: '北京烤鸭', description: '北京名菜，皮脆肉嫩' },
    })

    // 验证 LLM 收到的 userPrompt 包含 metadata 内容
    let capturedUserPrompt = ''
    mockCall.mockImplementationOnce(async (input: { userPrompt: string }) => {
      capturedUserPrompt = input.userPrompt
      return {
        output: { suggestions: [{ tagId: tag.id, confidence: 0.9, reasoning: '北京菜' }] },
        text: '',
        model: 'anthropic/claude-3-haiku-20240307',
      }
    })

    const res = await app2.request('/entities/dish/dish-with-meta/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    // metadata 应已出现在 prompt 里
    expect(capturedUserPrompt).toContain('北京烤鸭')
    expect(capturedUserPrompt).toContain('皮脆肉嫩')
  })

  it('suggest: body context merges with and overrides entity metadata', async () => {
    const group  = await makeGroup({ slug: 'ovr-cuisine', name: '菜系' })
    const tag    = await makeTag({ groupId: group.id, slug: 'cantonese', name: '粤菜' })

    await registerEntity('dish', 'dish-override', {
      metadata: { name: '旧名字', region: '广东' },
    })

    let capturedUserPrompt = ''
    mockCall.mockImplementationOnce(async (input: { userPrompt: string }) => {
      capturedUserPrompt = input.userPrompt
      return {
        output: { suggestions: [{ tagId: tag.id, confidence: 0.85, reasoning: '粤菜' }] },
        text: '',
        model: 'anthropic/claude-3-haiku-20240307',
      }
    })

    const res = await app2.request('/entities/dish/dish-override/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // body.context 的 name 应覆盖 metadata 的 name
      body: JSON.stringify({ context: { name: '新名字（覆盖）' } }),
    })
    expect(res.status).toBe(200)
    expect(capturedUserPrompt).toContain('新名字（覆盖）')   // body context 优先
    expect(capturedUserPrompt).toContain('广东')              // metadata 其余字段保留
    expect(capturedUserPrompt).not.toContain('旧名字')        // 被覆盖
  })
})
