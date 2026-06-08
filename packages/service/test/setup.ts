/**
 * Per-worker setup — runs once per test FILE.
 * Resets all tables between tests so each test starts from a clean slate.
 */

import { afterAll, beforeEach } from 'vitest'
import { prisma } from './helpers.js'

// 设置测试时区偏移为 UTC+8，在所有模块 import 前生效（#148）。
// 必须在 time.ts 被首次 import 前设置，因为 APP_TZ_OFFSET_MIN 是模块级常量。
process.env.APP_TZ_OFFSET_MIN = '480'

// 真实物理顺序：先清子表后清父表，避免 FK 阻塞
const TABLES_IN_ORDER = [
  'WebhookDelivery',
  'Webhook',
  'EventOutbox',
  'EntityTagReview',
  'EntityTag',
  'TagGroupEntityRule',
  'TagMergeLog',
  'TagMoveLog',
  'TagAlias',
  'SystemConfig',
  'RegisteredEntity',
  'Tag',
  'TagGroup',
]

beforeEach(async () => {
  // TRUNCATE 一次性清空 + CASCADE 处理 FK + RESTART IDENTITY 重置自增
  // 用引号包裹是因为 Prisma 的表名是 PascalCase（在 PostgreSQL 里大小写敏感）
  const tableList = TABLES_IN_ORDER.map(t => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  // Clean up API tokens so dev-bypass is restored for subsequent test files
  await prisma.apiToken.deleteMany()
  await prisma.$disconnect()
})
