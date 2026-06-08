/**
 * Vitest global setup — runs ONCE per test run.
 *
 * Responsibilities:
 *   1. Read TEST_DATABASE_URL (required).
 *   2. Create a unique schema `test_<timestamp>_<rand>` in that database.
 *   3. Run `prisma migrate deploy` against the new schema.
 *   4. Re-export the connection string (with ?schema=...) via process.env.DATABASE_URL
 *      so test files and the production code under test use the isolated schema.
 *   5. On teardown, drop the schema (CASCADE) so we leave no trash behind.
 *
 * Why schema-based isolation instead of testcontainers:
 *   - No Docker dependency for the developer (CI uses GitHub Actions
 *     service container; locally any Postgres works).
 *   - Faster startup than a full DB create/drop.
 *   - Parallel test runs in CI use different schemas → no collisions.
 */

import { execSync } from 'node:child_process'
import { Client } from 'pg'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `${name} is required to run tests. ` +
      `Set it to a Postgres connection string with permission to CREATE/DROP SCHEMA. ` +
      `Example: postgres://user:pass@localhost:5432/devdb`,
    )
  }
  return v
}

function newSchemaName(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `test_${Date.now()}_${rand}`
}

function urlWithSchema(baseUrl: string, schema: string): string {
  const u = new URL(baseUrl)
  u.searchParams.set('schema', schema)
  return u.toString()
}

export default async function setup() {
  const baseUrl = requireEnv('TEST_DATABASE_URL')
  const schema  = newSchemaName()

  // Rate limiter 在 in-memory sliding window 中共享 bucket（pool=forks, singleFork
  // 让所有测试共一个进程），生产默认 60 writes/min 会被多个 POST-heavy 测试
  // 累积击穿，导致后续测试随机拿到 429。测试时把上限调成天文数字让限流不再生效。
  // 生产代码本身的限流逻辑由专门的限流测试覆盖（若需要）。
  process.env.RATE_LIMIT_MAX       = '1000000'
  process.env.RATE_LIMIT_WRITE_MAX = '1000000'
  // 测试使用 UTC+8（中国标准时间）做日切，覆盖 #148 时区修复。
  // 必须在此设置（import 之前），因为 time.ts 的 APP_TZ_OFFSET_MIN
  // 是模块级常量，在首次 import 时即求值。
  process.env.APP_TZ_OFFSET_MIN    = '480'

  // 1. CREATE SCHEMA via raw pg client (Prisma can't create schemas)
  const admin = new Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`CREATE SCHEMA "${schema}"`)
  // Install pg_trgm INTO the isolated test schema so migration 20260530000000's
  // unqualified `gin_trgm_ops` resolves under Prisma's search_path (= this schema).
  // We must NOT schema-qualify the opclass in the migration itself: that file is
  // already applied on real DBs and editing it would trip Prisma drift detection.
  // Installing into the per-run schema keeps the migration immutable and is dropped
  // by the DROP SCHEMA CASCADE on teardown. (CI's fresh Postgres has no pre-existing
  // pg_trgm; if a throwaway DB already has it in public, drop it there first.)
  await admin.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA "${schema}"`)
  await admin.end()

  // 2. Point DATABASE_URL at the new schema and run migrations
  const testUrl = urlWithSchema(baseUrl, schema)
  process.env.DATABASE_URL  = testUrl
  process.env._TEST_SCHEMA  = schema
  process.env._TEST_BASE_URL = baseUrl

  execSync('pnpm exec prisma migrate deploy', {
    cwd:   new URL('../', import.meta.url).pathname,
    env:   { ...process.env, DATABASE_URL: testUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  // 3. Teardown — drop the schema so we don't pollute the database
  return async () => {
    const c = new Client({ connectionString: baseUrl })
    await c.connect()
    try {
      await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await c.end()
    }
  }
}
