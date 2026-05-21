/**
 * validateTags — pure validation logic for batch tag operations.
 * Covers: tag existence, entityScope compatibility, allowMultiple constraint
 * with TagGroupEntityRule override.
 */

import { describe, it, expect } from 'vitest'
import { validateTags } from '../src/lib/validate-tags.js'
import { prisma } from './helpers.js'
import { makeGroup, makeTag } from './helpers.js'

describe('validateTags', () => {
  it('returns null for empty input', async () => {
    expect(await validateTags([], 'dish')).toBeNull()
  })

  it('rejects unknown tag ids with a 标签不存在 message listing them', async () => {
    const result = await validateTags(['no-such-tag-1', 'no-such-tag-2'], 'dish')
    expect(result).toMatch(/标签不存在/)
    expect(result).toContain('no-such-tag-1')
    expect(result).toContain('no-such-tag-2')
  })

  it('rejects soft-deleted tags as if they did not exist', async () => {
    const group = await makeGroup()
    const tag   = await makeTag({ groupId: group.id })
    await prisma.tag.update({ where: { id: tag.id }, data: { deletedAt: new Date() } })

    const result = await validateTags([tag.id], 'dish')
    expect(result).toMatch(/标签不存在/)
  })

  it('rejects a tag whose group has entityScopes that exclude the entityType', async () => {
    const group = await makeGroup({ entityScopes: ['dining'] })
    const tag   = await makeTag({ groupId: group.id })

    const result = await validateTags([tag.id], 'dish')
    expect(result).toMatch(/不适用于实体类型 dish/)
  })

  it('allows a tag whose group has empty entityScopes (universal)', async () => {
    const group = await makeGroup({ entityScopes: [] })
    const tag   = await makeTag({ groupId: group.id })
    expect(await validateTags([tag.id], 'dish')).toBeNull()
  })

  it('rejects multiple tags from the same group when allowMultiple=false', async () => {
    const group = await makeGroup({ allowMultiple: false })
    const a = await makeTag({ groupId: group.id })
    const b = await makeTag({ groupId: group.id })

    const result = await validateTags([a.id, b.id], 'dish')
    expect(result).toMatch(/不允许多选/)
  })

  it('allows multiple tags from the same group when allowMultiple=true', async () => {
    const group = await makeGroup({ allowMultiple: true })
    const a = await makeTag({ groupId: group.id })
    const b = await makeTag({ groupId: group.id })
    expect(await validateTags([a.id, b.id], 'dish')).toBeNull()
  })

  it('TagGroupEntityRule override TAKES PRECEDENCE over group default (false→true)', async () => {
    const group = await makeGroup({ allowMultiple: false })
    await prisma.tagGroupEntityRule.create({
      data: { groupId: group.id, entityType: 'dish', allowMultiple: true },
    })
    const a = await makeTag({ groupId: group.id })
    const b = await makeTag({ groupId: group.id })

    // dish 覆盖到 true → 允许多选
    expect(await validateTags([a.id, b.id], 'dish')).toBeNull()
    // 其他实体类型仍然按 group 默认 false → 拒绝
    const result = await validateTags([a.id, b.id], 'dining')
    expect(result).toMatch(/不允许多选/)
  })

  it('TagGroupEntityRule override TAKES PRECEDENCE over group default (true→false)', async () => {
    const group = await makeGroup({ allowMultiple: true })
    await prisma.tagGroupEntityRule.create({
      data: { groupId: group.id, entityType: 'dish', allowMultiple: false },
    })
    const a = await makeTag({ groupId: group.id })
    const b = await makeTag({ groupId: group.id })

    const result = await validateTags([a.id, b.id], 'dish')
    expect(result).toMatch(/不允许多选/)
    // dining 仍然走 group default true
    expect(await validateTags([a.id, b.id], 'dining')).toBeNull()
  })

  it('does not penalize tags from DIFFERENT groups even when one group is single-select', async () => {
    const groupSingle = await makeGroup({ allowMultiple: false })
    const groupMulti  = await makeGroup({ allowMultiple: true })

    const a = await makeTag({ groupId: groupSingle.id })
    const b = await makeTag({ groupId: groupMulti.id })
    const c = await makeTag({ groupId: groupMulti.id })

    // 不同 group：a 单选 group 唯一一个、b+c 同属多选 group → 全部合法
    expect(await validateTags([a.id, b.id, c.id], 'dish')).toBeNull()
  })
})
