/**
 * 共享常量 + 层级工具函数
 * （被 crud.ts / query.ts / operations.ts 共同引用）
 */
import prisma from '../../lib/db.js'

export const MAX_NAME_LENGTH = 50
export const MAX_SLUG_LENGTH = 100
export const MAX_DESC_LENGTH = 200
export const MAX_DEPTH       = 5
export const SLUG_FORMAT     = /^[a-z0-9][a-z0-9_-]*$/

/** 由父路径 + 当前 slug 拼接物化路径 */
export function buildPath(parentPath: string, slug: string): string {
  return `${parentPath}${slug}/`
}

/**
 * 校验 parentId：存在、同组、深度未超限、无循环。
 * currentTagPath 为 null 时（创建场景）跳过循环检测。
 */
export async function validateParent(
  parentId: string,
  groupId: string,
  currentTagPath: string | null,
): Promise<{ parent: { id: string; path: string; depth: number } } | { error: string; status: 400 | 404 }> {
  const parent = await prisma.tag.findUnique({
    where: { id: parentId, deletedAt: null },
    select: { id: true, groupId: true, path: true, depth: true },
  })
  if (!parent) return { error: '父标签不存在', status: 404 }
  if (parent.groupId !== groupId) return { error: '父标签必须与当前标签同属一个分组', status: 400 }
  if (parent.depth >= MAX_DEPTH) return { error: `层级深度不能超过 ${MAX_DEPTH} 层`, status: 400 }

  // 循环检测：若被移动的标签是 parent 的祖先（parent.path 以 currentTag.path 开头），则拒绝
  if (currentTagPath && parent.path.startsWith(currentTagPath)) {
    return { error: '不能将标签设为其子孙标签的父标签（会形成循环）', status: 400 }
  }

  return { parent }
}
