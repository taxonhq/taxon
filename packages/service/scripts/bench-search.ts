/**
 * /search/entities 性能基线（issue #44）
 *
 * 在已 seed 的 perf 数据集（推荐 100k dish × 5 标签）上跑 5 个代表查询，
 * 输出 p50 / p95 / p99 + 总耗时，便于回归对比。
 *
 * 用法：
 *   pnpm seed:perf                        # 先把数据灌进去
 *   pnpm bench:search                     # 默认跑 50 次/查询
 *   pnpm bench:search -- --iterations 100 # 自定义次数
 *   pnpm bench:search -- --explain        # 额外对三层嵌套做 EXPLAIN ANALYZE
 *   pnpm bench:search -- --md > docs/perf/search-baseline-raw.md
 *
 * 设计：
 *   - 直接调 compileBoolExpr + $queryRaw，跳过 HTTP / Hono，专测 SQL 编译 + 执行
 *   - 每个查询冷启动一次（先单次 throwaway 让 plan cache 命中），再 N 次计时
 *   - 用手算 percentile，不依赖 tinybench 的 stats（更可控）
 */
import { Prisma } from '@prisma/client'
import prisma from '../src/lib/db.js'
import { compileBoolExpr } from '../src/lib/search/compile.js'
import type { BoolExpr } from '../src/lib/schemas.js'

const args = process.argv.slice(2)
const iterations = (() => {
  const i = args.indexOf('--iterations')
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 50
})()
const entityType  = 'dish'
const wantExplain = args.includes('--explain')
const asMd        = args.includes('--md')

// ── helpers ──────────────────────────────────────────────────────────────────
function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return NaN
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1)
  return sortedMs[Math.max(0, idx)]
}

async function runOnce(expr: BoolExpr | null): Promise<number> {
  const t0 = process.hrtime.bigint()
  const filterSql = expr
    ? Prisma.sql`AND ${await compileBoolExpr(expr)}`
    : Prisma.empty
  await prisma.$queryRaw(Prisma.sql`
    SELECT re."entityType", re."entityId", re."registeredAt"
    FROM "RegisteredEntity" re
    WHERE re."entityType" = ${entityType}
      ${filterSql}
    ORDER BY re."registeredAt" DESC, re."entityId" ASC
    LIMIT 20 OFFSET 0
  `)
  const t1 = process.hrtime.bigint()
  return Number(t1 - t0) / 1e6
}

async function countOnce(expr: BoolExpr | null): Promise<number> {
  const filterSql = expr
    ? Prisma.sql`AND ${await compileBoolExpr(expr)}`
    : Prisma.empty
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "RegisteredEntity" re
    WHERE re."entityType" = ${entityType} ${filterSql}
  `)
  return Number(rows[0]?.count ?? 0)
}

type Case = { name: string; expr: BoolExpr | null; note?: string }

async function bench(c: Case) {
  // 冷启动一次（不计入；让 Postgres 缓存 plan）
  await runOnce(c.expr)

  const samples: number[] = []
  for (let i = 0; i < iterations; i++) samples.push(await runOnce(c.expr))
  samples.sort((a, b) => a - b)

  const hits = await countOnce(c.expr)
  return {
    name: c.name,
    note: c.note ?? '',
    hits,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    min: samples[0],
    max: samples[samples.length - 1],
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  // 取若干 perf 数据集的 tagId / slug，构造代表性查询
  const someTags = await prisma.tag.findMany({
    where: { group: { slug: { startsWith: 'perf-grp-' } } },
    select: { id: true, slug: true, group: { select: { slug: true } } },
    take: 12,
  })
  if (someTags.length < 8) {
    console.error('❌ perf 数据不足。先跑：pnpm seed:perf')
    process.exit(1)
  }
  const [t1, t2, t3, t4, t5, t6, t7, t8] = someTags

  const totalEntities = await prisma.registeredEntity.count({ where: { entityType } })
  const totalEntityTags = await prisma.entityTag.count({ where: { entityType } })

  const cases: Case[] = [
    {
      name: '1. 单 tag (id)',
      expr: { tag: t1.id },
    },
    {
      name: '2. 单 tag (slug + group)',
      expr: { tagSlug: t1.slug, groupSlug: t1.group.slug },
    },
    {
      name: '3. OR 2 tags',
      expr: { or: [{ tag: t1.id }, { tag: t2.id }] },
    },
    {
      name: '4. AND 3 维',
      expr: {
        and: [
          { tag: t3.id },
          { source: ['ai'] },
          { confidence: { gte: 0.7 } },
        ],
      },
    },
    {
      name: '5. 三层嵌套 (OR + NOT + confidence)',
      note: '(t5 OR t6) AND NOT t7 AND confidence>=0.6',
      expr: {
        and: [
          { or:  [{ tag: t5.id }, { tag: t6.id }] },
          { not: { tag: t7.id } },
          { confidence: { gte: 0.6 } },
        ],
      },
    },
    {
      name: '6. 全集（无 filter，baseline）',
      expr: null,
    },
    {
      name: '7. NOT 单 tag（反向，命中量大）',
      expr: { not: { tag: t8.id } },
    },
  ]

  // env 信息
  const pgVersion = (await prisma.$queryRaw<Array<{ v: string }>>(Prisma.sql`SELECT version() AS v`))[0]?.v
  const nodeVersion = process.version
  const platform = `${process.platform} ${process.arch}`

  // 结果收集
  const results: Awaited<ReturnType<typeof bench>>[] = []
  for (const c of cases) {
    process.stderr.write(`▶ ${c.name} … `)
    const r = await bench(c)
    process.stderr.write(`p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms p99=${r.p99.toFixed(1)}ms (hits=${r.hits})\n`)
    results.push(r)
  }

  // 三层嵌套 EXPLAIN（如果要）
  let explain: string | undefined
  if (wantExplain) {
    const nested = cases.find(c => c.name.startsWith('5.'))!.expr!
    const filterSql = Prisma.sql`AND ${await compileBoolExpr(nested)}`
    const rows = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT re."entityType", re."entityId", re."registeredAt"
      FROM "RegisteredEntity" re
      WHERE re."entityType" = ${entityType} ${filterSql}
      ORDER BY re."registeredAt" DESC, re."entityId" ASC LIMIT 20
    `)
    explain = rows.map(r => r['QUERY PLAN']).join('\n')
  }

  // 输出
  if (asMd) {
    process.stdout.write(`# /search/entities 性能基线\n\n`)
    process.stdout.write(`- iterations / query: **${iterations}**（外加一次冷启动 throwaway）\n`)
    process.stdout.write(`- 数据规模：${totalEntities.toLocaleString()} 个 ${entityType} 实体，${totalEntityTags.toLocaleString()} 个 EntityTag\n`)
    process.stdout.write(`- Node: ${nodeVersion}，平台：${platform}\n`)
    process.stdout.write(`- PostgreSQL: ${pgVersion}\n\n`)
    process.stdout.write(`## 结果\n\n`)
    process.stdout.write(`| # | 查询 | hits | p50 (ms) | p95 (ms) | p99 (ms) | min | max |\n`)
    process.stdout.write(`|---|------|------|---------|---------|---------|-----|-----|\n`)
    for (const r of results) {
      process.stdout.write(`| ${r.name} | ${r.note} | ${r.hits.toLocaleString()} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.min.toFixed(1)} | ${r.max.toFixed(1)} |\n`)
    }
    if (explain) {
      process.stdout.write(`\n## EXPLAIN ANALYZE — 三层嵌套\n\n\`\`\`\n${explain}\n\`\`\`\n`)
    }
  } else {
    console.log('\n=== 结果 ===')
    console.log(`数据：${totalEntities.toLocaleString()} 实体 / ${totalEntityTags.toLocaleString()} EntityTag`)
    console.log(`Node ${nodeVersion}, ${platform}`)
    console.log(`PG: ${pgVersion}`)
    console.table(results.map(r => ({
      query: r.name,
      hits: r.hits.toLocaleString(),
      p50: r.p50.toFixed(1),
      p95: r.p95.toFixed(1),
      p99: r.p99.toFixed(1),
    })))
    if (explain) console.log('\n--- EXPLAIN ANALYZE (三层嵌套) ---\n' + explain)
  }
}

main()
  .catch(e => { console.error('❌ bench failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
