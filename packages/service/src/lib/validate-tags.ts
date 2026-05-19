import prisma from './db.js'

// validateTags: 校验 tagIds 的存在性、entityScopes 匹配、allowMultiple 约束
// allowMultiple 优先使用 TagGroupEntityRule 的实体类型级覆盖，回退到分组默认值
export async function validateTags(tagIds: string[], entityType: string): Promise<string | null> {
  if (tagIds.length === 0) return null

  const tags = await prisma.tag.findMany({
    where: { id: { in: tagIds }, deletedAt: null },
    select: {
      id: true,
      groupId: true,
      group: {
        select: {
          name: true,
          allowMultiple: true,
          entityScopes: true,
          entityRules: {
            where: { entityType },
            select: { allowMultiple: true },
          },
        },
      },
    },
  })

  if (tags.length !== tagIds.length) {
    const foundIds = new Set(tags.map((t: { id: string }) => t.id))
    const missing = tagIds.filter(id => !foundIds.has(id))
    return `标签不存在: ${missing.join(', ')}`
  }

  for (const tag of tags) {
    if (tag.group.entityScopes.length > 0 && !tag.group.entityScopes.includes(entityType)) {
      return `分组「${tag.group.name}」不适用于实体类型 ${entityType}`
    }
  }

  type GroupEntry = { name: string; allowMultiple: boolean; count: number }
  const groupCounts = new Map<string, GroupEntry>()
  for (const tag of tags) {
    const effectiveAllowMultiple =
      tag.group.entityRules.length > 0
        ? tag.group.entityRules[0].allowMultiple
        : tag.group.allowMultiple

    const entry = groupCounts.get(tag.groupId)
    if (entry) {
      entry.count++
    } else {
      groupCounts.set(tag.groupId, { name: tag.group.name, allowMultiple: effectiveAllowMultiple, count: 1 })
    }
  }
  for (const [, { name, allowMultiple, count }] of groupCounts) {
    if (!allowMultiple && count > 1) return `分组「${name}」不允许多选`
  }

  return null
}
