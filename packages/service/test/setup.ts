/**
 * Per-worker setup — runs once per test FILE.
 * Resets all tables between tests so each test starts from a clean slate.
 */

import { afterAll, beforeEach } from 'vitest'
import { prisma } from './helpers.js'

// 真实物理顺序：先清子表后清父表，避免 FK 阻塞
const TABLES_IN_ORDER = [
  'WebhookDelivery',
  'Webhook',
  'EventOutbox',
  'EntityTag',
  'TagGroupEntityRule',
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
  await prisma.$disconnect()
})
