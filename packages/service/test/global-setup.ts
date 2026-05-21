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

  // 1. CREATE SCHEMA via raw pg client (Prisma can't create schemas)
  const admin = new Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`CREATE SCHEMA "${schema}"`)
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
