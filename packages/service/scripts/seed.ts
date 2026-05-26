/**
 * Taxon Demo / Perf 种子脚本
 *
 * 用法：
 *   pnpm seed:demo   — 小规模（dish 200 / restaurant 80 / ingredient 50）
 *   pnpm seed:perf   — 大规模性能基线（dish 100k）
 *   tsx scripts/seed.ts demo                          # demo 模式
 *   tsx scripts/seed.ts perf --entities 100000        # 自定义 perf 规模
 *   tsx scripts/seed.ts demo --reset                  # 先清空再写（dangerous）
 *
 * 设计：
 *   - 复用现有 group / tag / 实体；不清表（除非 --reset）
 *   - 用 createMany + skipDuplicates 处理唯一冲突
 *   - source / status / confidence 按真实场景分布（70% manual-active /
 *     20% ai-active / 10% ai-pending）
 *   - 添加常用别名样本（"麻辣" → mala-savory + spicy-fragrant 等）
 */

import { PrismaClient, TagSource, TagStatus } from '@prisma/client'

const prisma = new PrismaClient()

// ── 配置 ────────────────────────────────────────────────────────────────────
interface SeedConfig {
  mode: 'demo' | 'perf'
  reset: boolean
  // perf 模式可配置
  entities: number   // dish 实体数量
  tagsPerEntity: number  // 每实体平均 tag 数
  groupCount?: number    // perf 模式 group 数
  tagsPerGroup?: number  // perf 模式每 group tag 数
}

function parseArgs(): SeedConfig {
  const args = process.argv.slice(2)
  const mode = (args[0] === 'perf' ? 'perf' : 'demo') as 'demo' | 'perf'
  const reset = args.includes('--reset')
  const get = (flag: string, def: number): number => {
    const i = args.indexOf(flag)
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def
  }
  if (mode === 'perf') {
    return {
      mode, reset,
      entities:      get('--entities', 100000),
      tagsPerEntity: get('--tags-per-entity', 5),
      groupCount:    get('--groups', 30),
      tagsPerGroup:  get('--tags-per-group', 20),
    }
  }
  return { mode, reset, entities: get('--entities', 200), tagsPerEntity: 5 }
}

// ── 工具 ────────────────────────────────────────────────────────────────────
const randPick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randPickN = <T,>(arr: T[], n: number): T[] => {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(n, arr.length))
}
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const randFloat = (min: number, max: number) => Math.random() * (max - min) + min

// ── Demo 数据 ───────────────────────────────────────────────────────────────
// 现有数据已经有 cuisine / taste / cooking / category，这里补 dietary + price-range
// 并对现有 group 补充一些有别名的标签
const DEMO_GROUPS: Array<{
  slug: string; name: string; description?: string
  entityScopes: string[]; allowMultiple: boolean
}> = [
  // 既有 group 的 upsert（保证存在）
  { slug: 'cuisine',  name: '菜系',     entityScopes: ['dish', 'restaurant'], allowMultiple: false,
    description: '中餐 / 西餐等菜系归属，单实体一般只属于一个菜系' },
  { slug: 'taste',    name: '口味',     entityScopes: ['dish'],               allowMultiple: true,
    description: '口味描述：麻辣、清淡、酸甜等' },
  { slug: 'cooking',  name: '烹饪工艺', entityScopes: ['dish'],               allowMultiple: true,
    description: '烹饪方式：炒、煮、蒸、烤等' },
  { slug: 'category', name: '分类',     entityScopes: ['dish'],               allowMultiple: false,
    description: '热菜 / 凉菜 / 点心等大类' },
  // 新增 group
  { slug: 'dietary',     name: '饮食偏好', entityScopes: ['dish', 'restaurant', 'ingredient'], allowMultiple: true,
    description: '素食 / 清真 / 无麸质等饮食限制标记' },
  { slug: 'price-range', name: '价位',     entityScopes: ['restaurant'],                       allowMultiple: false,
    description: '人均消费区间' },
  { slug: 'origin',      name: '产地',     entityScopes: ['ingredient'],                       allowMultiple: false,
    description: '食材产地' },
]

const DEMO_TAGS: Record<string, Array<{ slug: string; name: string; aliases?: string[] }>> = {
  // 注意：现有 cuisine / taste / cooking / category 标签先不动（避免冲突），只新增缺失的
  cuisine: [
    { slug: 'sichuan',    name: '川菜',  aliases: ['四川菜', '川渝菜'] },
    { slug: 'cantonese',  name: '粤菜',  aliases: ['广东菜'] },
    { slug: 'hunan',      name: '湘菜',  aliases: ['湖南菜'] },
    { slug: 'shandong',   name: '鲁菜',  aliases: ['山东菜'] },
    { slug: 'huaiyang',   name: '淮扬',  aliases: ['淮扬菜', '苏菜'] },
    { slug: 'zhejiang',   name: '浙菜',  aliases: ['浙江菜'] },
    { slug: 'northeast',  name: '东北菜', aliases: ['东北'] },
    { slug: 'xinjiang',   name: '新疆菜', aliases: ['新疆'] },
    { slug: 'japanese',   name: '日料',  aliases: ['日本菜', '和食'] },
    { slug: 'italian',    name: '意餐',  aliases: ['意大利菜'] },
    { slug: 'thai',       name: '泰餐',  aliases: ['泰国菜'] },
    { slug: 'korean',     name: '韩餐',  aliases: ['韩国菜'] },
  ],
  taste: [
    { slug: 'mala-savory',      name: '麻辣鲜香', aliases: ['麻辣', '辣'] },
    { slug: 'spicy-fragrant',   name: '香辣',     aliases: ['辣'] },
    { slug: 'sweet-sour',       name: '酸甜',     aliases: ['酸甜口', '糖醋'] },
    { slug: 'light-fresh',      name: '清淡鲜美', aliases: ['清淡'] },
    { slug: 'salty-fresh',      name: '咸鲜',     aliases: ['咸'] },
    { slug: 'savory-sweet',     name: '咸甜' },
    { slug: 'fresh-tender',     name: '鲜嫩' },
  ],
  cooking: [
    { slug: 'stir-fry',  name: '炒' },
    { slug: 'boil',      name: '煮' },
    { slug: 'steam',     name: '蒸' },
    { slug: 'roast',     name: '烤' },
    { slug: 'braise',    name: '炖' },
    { slug: 'braise-red',name: '烧' },
    { slug: 'deep-fry',  name: '炸' },
    { slug: 'cold',      name: '凉拌' },
  ],
  category: [
    { slug: 'hot-dish',  name: '热菜' },
    { slug: 'cold-dish', name: '凉菜' },
    { slug: 'dim-sum',   name: '点心' },
    { slug: 'soup',      name: '汤' },
    { slug: 'staple',    name: '主食' },
  ],
  dietary: [
    { slug: 'vegan',         name: '素食',     aliases: ['全素', 'vegan'] },
    { slug: 'vegetarian',    name: '蛋奶素',   aliases: ['vegetarian'] },
    { slug: 'halal',         name: '清真',     aliases: ['halal'] },
    { slug: 'gluten-free',   name: '无麸质',   aliases: ['无小麦'] },
    { slug: 'spicy-friendly',name: '微辣可调' },
    { slug: 'kid-friendly',  name: '儿童友好' },
  ],
  'price-range': [
    { slug: 'budget',     name: '人均 50 以下' },
    { slug: 'mid-range',  name: '人均 50-150' },
    { slug: 'upscale',    name: '人均 150-300' },
    { slug: 'fine-dining',name: '人均 300+' },
  ],
  origin: [
    { slug: 'local',       name: '本地' },
    { slug: 'imported',    name: '进口' },
    { slug: 'organic',     name: '有机认证' },
  ],
}

// ── 实体生成器 ──────────────────────────────────────────────────────────────
function dishName(i: number): string {
  const adj = ['麻辣', '清炒', '红烧', '酸甜', '凉拌', '蒸', '葱爆', '宫保', '糖醋', '水煮']
  const noun = ['牛肉', '鸡丁', '虾仁', '豆腐', '茄子', '土豆', '白菜', '排骨', '鱼片', '蘑菇']
  return `${randPick(adj)}${randPick(noun)} ${i}`
}
function restaurantName(i: number): string {
  const prefix = ['老', '小', '大', '新', '川', '蜀', '渝', '湘', '粤']
  const middle = ['福', '记', '香', '味', '园', '苑', '楼', '居', '轩']
  return `${randPick(prefix)}${randPick(middle)}餐厅 ${i}`
}
function ingredientName(i: number): string {
  return `食材-${i}`
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const cfg = parseArgs()
  console.log(`\n🌱 Taxon seed — mode: ${cfg.mode}`)
  console.log(`   entities=${cfg.entities}, avg tags/entity=${cfg.tagsPerEntity}`)
  if (cfg.reset) console.log(`   ⚠️  --reset：清空现有数据`)

  const t0 = Date.now()

  if (cfg.reset) await resetAll()

  await seedGroups(cfg)
  const groupMap = await loadGroupMap()

  await seedTags(cfg, groupMap)
  const tagsByGroup = await loadTagsByGroup()

  await seedAliases(tagsByGroup)

  if (cfg.mode === 'demo') {
    await seedDemoEntities(cfg, tagsByGroup)
  } else {
    await seedPerfEntities(cfg, tagsByGroup)
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  await printSummary(elapsed)
}

async function resetAll() {
  await prisma.entityTagReview.deleteMany({})
  await prisma.entityTag.deleteMany({})
  await prisma.registeredEntity.deleteMany({})
  await prisma.tagAlias.deleteMany({})
  await prisma.tag.deleteMany({})
  await prisma.tagGroupEntityRule.deleteMany({})
  await prisma.tagGroup.deleteMany({})
  console.log(`   ✓ all tag tables cleared`)
}

async function seedGroups(cfg: SeedConfig) {
  if (cfg.mode === 'perf') {
    // perf 模式：生成 N 个合成 group
    const total = cfg.groupCount ?? 30
    const existing = await prisma.tagGroup.count({ where: { deletedAt: null } })
    const toCreate = Math.max(0, total - existing)
    if (toCreate > 0) {
      for (let i = existing; i < total; i++) {
        await prisma.tagGroup.upsert({
          where:  { id: `perf_grp_${i}` },
          create: {
            id: `perf_grp_${i}`,
            slug: `perf-grp-${i}`, name: `性能组${i}`,
            entityScopes: ['dish'], allowMultiple: true,
          },
          update: {},
        })
      }
    }
    console.log(`   ✓ groups: ${total} 个（perf 模式合成）`)
    return
  }

  // demo 模式：upsert by slug
  for (const g of DEMO_GROUPS) {
    const found = await prisma.tagGroup.findFirst({ where: { slug: g.slug, deletedAt: null } })
    if (found) {
      await prisma.tagGroup.update({ where: { id: found.id }, data: g })
    } else {
      await prisma.tagGroup.create({ data: g })
    }
  }
  console.log(`   ✓ groups: ${DEMO_GROUPS.length} 个（demo）`)
}

async function loadGroupMap(): Promise<Map<string, string>> {
  const groups = await prisma.tagGroup.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true },
  })
  return new Map(groups.map(g => [g.slug, g.id]))
}

async function seedTags(cfg: SeedConfig, groupMap: Map<string, string>) {
  if (cfg.mode === 'perf') {
    const N = cfg.tagsPerGroup ?? 20
    for (const [slug, gid] of groupMap.entries()) {
      if (!slug.startsWith('perf-grp-')) continue
      const existing = await prisma.tag.count({ where: { groupId: gid, deletedAt: null } })
      const toCreate = Math.max(0, N - existing)
      if (toCreate === 0) continue
      const data = Array.from({ length: toCreate }, (_, i) => ({
        groupId: gid, slug: `${slug}-tag-${existing + i}`,
        name: `${slug}-tag${existing + i}`,
        path: `/${slug}-tag-${existing + i}/`, depth: 0,
      }))
      await prisma.tag.createMany({ data, skipDuplicates: true })
    }
    const totalTags = await prisma.tag.count({ where: { deletedAt: null } })
    console.log(`   ✓ tags: ${totalTags} 总（perf 模式合成）`)
    return
  }

  let added = 0
  for (const [slug, tags] of Object.entries(DEMO_TAGS)) {
    const gid = groupMap.get(slug)
    if (!gid) continue
    for (const t of tags) {
      // 用 slug OR name 查（任一冲突都跳过，避免 partial-unique 约束触发）
      const found = await prisma.tag.findFirst({
        where: {
          groupId: gid, deletedAt: null,
          OR: [{ slug: t.slug }, { name: t.name }],
        },
        select: { id: true },
      })
      if (!found) {
        await prisma.tag.create({
          data: {
            groupId: gid, slug: t.slug, name: t.name,
            path: `/${t.slug}/`, depth: 0,
          },
        })
        added++
      }
    }
  }
  console.log(`   ✓ tags: 新增 ${added} 个`)
}

async function loadTagsByGroup(): Promise<Map<string, Array<{ id: string; slug: string }>>> {
  const tags = await prisma.tag.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, groupId: true, group: { select: { slug: true } } },
  })
  const m = new Map<string, Array<{ id: string; slug: string }>>()
  for (const t of tags) {
    const arr = m.get(t.group.slug) ?? []
    arr.push({ id: t.id, slug: t.slug })
    m.set(t.group.slug, arr)
  }
  return m
}

async function seedAliases(tagsByGroup: Map<string, Array<{ id: string; slug: string }>>) {
  // 只 demo 模式做，perf 不需要
  let added = 0
  for (const [groupSlug, tagDefs] of Object.entries(DEMO_TAGS)) {
    const groupTags = tagsByGroup.get(groupSlug)
    if (!groupTags) continue
    for (const def of tagDefs) {
      if (!def.aliases || def.aliases.length === 0) continue
      const tag = groupTags.find(t => t.slug === def.slug)
      if (!tag) continue
      for (const a of def.aliases) {
        const exists = await prisma.tagAlias.findFirst({ where: { tagId: tag.id, alias: a }, select: { id: true } })
        if (!exists) {
          await prisma.tagAlias.create({ data: { tagId: tag.id, alias: a, source: 'import' } })
          added++
        }
      }
    }
  }
  console.log(`   ✓ aliases: 新增 ${added} 个`)
}

function pickEntityTagMeta(): { source: TagSource; status: TagStatus; confidence: number | null } {
  const r = Math.random()
  if (r < 0.7) {
    return { source: 'manual', status: 'active', confidence: null }
  }
  if (r < 0.9) {
    return { source: 'ai', status: 'active', confidence: parseFloat(randFloat(0.6, 0.95).toFixed(3)) }
  }
  return { source: 'ai', status: 'pending', confidence: parseFloat(randFloat(0.4, 0.7).toFixed(3)) }
}

async function seedDemoEntities(
  _cfg: SeedConfig,
  tagsByGroup: Map<string, Array<{ id: string; slug: string }>>,
) {
  const DISH    = 200
  const REST    = 80
  const INGRED  = 50

  const cuisineTags = tagsByGroup.get('cuisine')   ?? []
  const tasteTags   = tagsByGroup.get('taste')     ?? []
  const cookTags    = tagsByGroup.get('cooking')   ?? []
  const catTags     = tagsByGroup.get('category')  ?? []
  const dietTags    = tagsByGroup.get('dietary')   ?? []
  const priceTags   = tagsByGroup.get('price-range') ?? []
  const originTags  = tagsByGroup.get('origin')    ?? []

  await createBatch('dish', DISH, dishName, (entityId) => {
    const tagIds: string[] = []
    if (cuisineTags.length) tagIds.push(randPick(cuisineTags).id)
    if (catTags.length)     tagIds.push(randPick(catTags).id)
    tagIds.push(...randPickN(tasteTags, randInt(1, 2)).map(t => t.id))
    tagIds.push(...randPickN(cookTags,  randInt(1, 2)).map(t => t.id))
    if (Math.random() < 0.25) tagIds.push(...randPickN(dietTags, 1).map(t => t.id))
    return makeEntityTags('dish', entityId, tagIds)
  })

  await createBatch('restaurant', REST, restaurantName, (entityId) => {
    const tagIds: string[] = []
    if (cuisineTags.length) tagIds.push(randPick(cuisineTags).id)
    if (priceTags.length)   tagIds.push(randPick(priceTags).id)
    if (Math.random() < 0.4) tagIds.push(...randPickN(dietTags, randInt(1, 2)).map(t => t.id))
    return makeEntityTags('restaurant', entityId, tagIds)
  })

  await createBatch('ingredient', INGRED, ingredientName, (entityId) => {
    const tagIds: string[] = []
    if (originTags.length) tagIds.push(randPick(originTags).id)
    if (Math.random() < 0.3 && dietTags.length) tagIds.push(...randPickN(dietTags, 1).map(t => t.id))
    return makeEntityTags('ingredient', entityId, tagIds)
  })

  console.log(`   ✓ entities: dish=${DISH}, restaurant=${REST}, ingredient=${INGRED}`)
}

async function seedPerfEntities(
  cfg: SeedConfig,
  tagsByGroup: Map<string, Array<{ id: string; slug: string }>>,
) {
  const allTags = Array.from(tagsByGroup.values()).flat()
  const target = cfg.entities
  const BATCH  = 1000

  for (let off = 0; off < target; off += BATCH) {
    const upper = Math.min(off + BATCH, target)
    const entities: Array<{ entityType: string; entityId: string; registeredAt: Date }> = []
    const entityTags: Array<{ tagId: string; entityType: string; entityId: string; source: TagSource; status: TagStatus; confidence: number | null }> = []
    for (let i = off; i < upper; i++) {
      const eid = `perf_dish_${i}`
      entities.push({ entityType: 'dish', entityId: eid, registeredAt: new Date(Date.now() - randInt(0, 30 * 24 * 3600 * 1000)) })
      const picks = randPickN(allTags, cfg.tagsPerEntity)
      for (const t of picks) {
        const meta = pickEntityTagMeta()
        entityTags.push({ tagId: t.id, entityType: 'dish', entityId: eid, ...meta })
      }
    }
    await prisma.registeredEntity.createMany({ data: entities, skipDuplicates: true })
    await prisma.entityTag.createMany({ data: entityTags, skipDuplicates: true })
    process.stdout.write(`\r   ⏳ entities: ${upper}/${target}`)
  }
  process.stdout.write('\n')
  console.log(`   ✓ entities: ${target} dish + ~${target * cfg.tagsPerEntity} EntityTag`)
}

async function createBatch(
  entityType: string, count: number,
  nameFn: (i: number) => string,
  buildEntityTags: (entityId: string) => Array<{
    tagId: string; entityType: string; entityId: string;
    source: TagSource; status: TagStatus; confidence: number | null
  }>,
) {
  const entities: Array<{ entityType: string; entityId: string; registeredAt: Date }> = []
  const allEntityTags: Array<ReturnType<typeof buildEntityTags>[number]> = []
  for (let i = 0; i < count; i++) {
    // 使用确定性 entityId（脚本可幂等 re-run）
    const eid = `${entityType}_${i + 1}`
    const _ = nameFn  // 当前 RegisteredEntity 不存名，保留 fn 仅为未来扩展
    entities.push({
      entityType, entityId: eid,
      registeredAt: new Date(Date.now() - randInt(0, 90 * 24 * 3600 * 1000)),
    })
    allEntityTags.push(...buildEntityTags(eid))
  }
  await prisma.registeredEntity.createMany({ data: entities, skipDuplicates: true })
  await prisma.entityTag.createMany({ data: allEntityTags, skipDuplicates: true })
}

function makeEntityTags(entityType: string, entityId: string, tagIds: string[]) {
  // 去重 tagIds（防止 randPick 重叠）
  const uniq = Array.from(new Set(tagIds))
  return uniq.map(tagId => ({
    tagId, entityType, entityId,
    ...pickEntityTagMeta(),
  }))
}

async function printSummary(elapsed: string) {
  const [groups, tags, aliases, ents, etgs] = await Promise.all([
    prisma.tagGroup.count({ where: { deletedAt: null } }),
    prisma.tag.count({ where: { deletedAt: null } }),
    prisma.tagAlias.count(),
    prisma.registeredEntity.count(),
    prisma.entityTag.count(),
  ])
  const [aiActive, aiPending] = await Promise.all([
    prisma.entityTag.count({ where: { source: 'ai', status: 'active' } }),
    prisma.entityTag.count({ where: { source: 'ai', status: 'pending' } }),
  ])
  console.log(`\n✅ done in ${elapsed}s`)
  console.log(`   groups=${groups}, tags=${tags}, aliases=${aliases}`)
  console.log(`   entities=${ents}, entityTags=${etgs}`)
  console.log(`   AI active=${aiActive}, AI pending=${aiPending}\n`)
}

main()
  .catch(e => {
    console.error('\n❌ seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
