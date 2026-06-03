/**
 * Tags router — 将各子模块路由按正确顺序挂载。
 *
 * 挂载顺序很重要：
 *   1. /resolve 等静态路径必须在 /:tagId 参数路由之前
 *   2. 操作路由（merge / move）也在 /:tagId 之前（否则被 GET /:tagId 吃掉）
 */
import { createRouter } from '../../lib/router.js'
import { tagsQuery }      from './query.js'
import { tagsCrud }       from './crud.js'
import { tagsOperations } from './operations.js'

const tags = createRouter()

// 静态前缀路由（/resolve）必须最先注册
tags.route('/', tagsQuery)

// 写操作（POST /、PATCH /:tagId、DELETE /:tagId）
tags.route('/', tagsCrud)

// 高级操作（/:targetId/merge、/:tagId/move）
tags.route('/', tagsOperations)

export { tags }
