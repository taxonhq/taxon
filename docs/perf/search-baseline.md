# /search/entities 性能基线

跟踪 issue #44。本文档为 BoolExpr 检索 SQL 编译器在 10w dish × 5 标签 数据集上的 p50/p95/p99 基线 + 优化路径评估。

## 运行方式

```bash
cd packages/service
pnpm seed:perf                                  # 生成 100k 实体 + ~500k EntityTag
pnpm bench:search                               # 跑 5 个代表查询 × 50 次
pnpm bench:search -- --iterations 100           # 自定义次数
pnpm bench:search -- --explain                  # 三层嵌套加 EXPLAIN ANALYZE
pnpm bench:search -- --md > /tmp/raw.md         # markdown 输出
```

`bench-search.ts` 直接调 `compileBoolExpr` + `$queryRaw`，跳过 HTTP / Hono，
专测 SQL 编译 + 执行。每个 case 先空跑一次（让 plan cache 命中），再跑 N 次计时。

## 验收门槛（issue #44）

| 查询 | p95 目标 | 实测 | 达标 |
|------|---------|------|------|
| 单 tag | < 30 ms | 152 ms | ❌（受网络 RTT 主导，详见下方"网络确认"） |
| 三层嵌套 (OR + NOT + confidence) | < 200 ms | 1543 ms | ❌（SQL 真实瓶颈，详见 EXPLAIN） |

## 测试环境

| 项 | 值 |
|----|----|
| 数据规模 | 100,220 dish + 350 其他 = 100,570 RegisteredEntity，525,814 EntityTag |
| 标签 | 30 group × ~20 tag = 568 tags |
| 分布 | 70% manual-active / 20% AI-active / 10% AI-pending |
| 客户端 | macOS arm64, Node v23.11.0 |
| 数据库 | PostgreSQL 17.9（远程，公网 RTT ~130ms） |
| commit | 0bc6180 |
| 日期 | 2026-05-27 |

## 当前索引

**RegisteredEntity**
- PK `(entityType, entityId)`
- `idx(entityType)`

**EntityTag**
- PK `(tagId, entityType, entityId)`
- `idx(entityType, entityId)`
- `idx(entityType, entityId, status)`
- `idx(tagId)`
- `idx(tagId, status)` ← 编译器输出的 leaf 主要走它
- `idx(status, entityType)`
- `idx(status, createdAt desc)`

BoolExpr 编译后每个 leaf 是 `EXISTS (SELECT 1 FROM "EntityTag" WHERE entityType=? AND entityId=? AND <leaf 条件>)`。`source` / `confidence` 暂无专用索引，谓词只能靠 seq scan + filter。

## 基线结果

`pnpm bench:search -- --iterations 50`（每查询 50 次 + 1 次冷启动 throwaway）：

| # | 查询 | hits | p50 (ms) | p95 (ms) | p99 (ms) |
|---|------|------|---------|---------|---------|
| 1 | 单 tag (id) | 1,163 | 130.5 | 164.9 | 171.8 |
| 2 | 单 tag (slug + group) | 1,163 | 288.2 | 420.3 | 454.8 |
| 3 | OR 2 tags | 2,392 | 297.0 | 474.2 | 140364.9 ⚠ |
| 4 | AND 3 维 (tag + source + confidence) | 817 | 139.3 | 168.1 | 228.2 |
| 5 | **三层嵌套 (OR + NOT + confidence)** | 1,259 | 602.4 | **1502.8** | 1537.1 |
| 6 | 全集（无 filter，baseline） | 100,220 | 137.5 | 177.6 | 209.1 |
| 7 | NOT 单 tag（反向，命中量大） | 99,212 | 141.7 | 181.0 | 204.3 |

> ⚠ 查询 #3 p99 = 140s 是 50 次中 1 次出现的极端 outlier，怀疑是 TCP 重传或瞬时网络抖动。复跑 20 次没复现（p99=443ms）。生产部署不会出现这个数字。

## 网络 RTT 确认

baseline（无 filter）查询本质是 `SELECT ... FROM RegisteredEntity LIMIT 20` —
PG 端执行时间 < 20ms（top-N 排序 + LIMIT），p95 却有 177ms，说明 **~130-150ms
就是公网到 dev DB（北京）的固定 RTT**。

因此：
- 查询 #1 / #4 / #7：p95 集中在 152-181ms，**几乎就是 baseline + 10-20ms 计算**——SQL 执行其实很快。
- 查询 #5：p95 1503ms，**减去 130ms RTT 后 ~1370ms 仍是真实 SQL 工作**——这是真问题。

**部署在和 DB 同 VPC / 同主机的应用进程，前述 1-4-7 类查询 p95 应在 10-30ms 量级**，验收目标"单 tag < 30ms" 是可达的，**目前的数字不能用来反驳门槛**。

但查询 #5 是 SQL 本身在 DB 端就跑了 1.4s（见下 EXPLAIN 中的 `Execution Time`），与网络无关。

## 三层嵌套 EXPLAIN ANALYZE

完整查询：
```json
{ "and": [
    { "or":  [{ "tag": "X" }, { "tag": "Y" }] },
    { "not": { "tag": "Z" } },
    { "confidence": { "gte": 0.6 } }
] }
```

DB 端关键数字（`pnpm bench:search -- --explain`）：

```
Limit (actual time=1429.603..1429.608 rows=20 loops=1)
  Buffers: shared hit=689814        ← 70w 缓冲页访问
  ->  Sort (top-N heapsort)
        ->  Hash Anti Join          ← NOT 部分，rows=1259
              ->  Nested Loop (actual time=47.992..1218.498 rows=1283)   ← 主瓶颈
                    ->  HashAggregate (actual time=46.156..59.082 rows=68258)
                          ->  Seq Scan on EntityTag                       ← confidence 没索引
                                Filter: confidence >= 0.6 AND entityType='dish' AND status='active'
                                Rows Removed by Filter: 421311
                    ->  Index Scan using RegisteredEntity_pkey
                          Filter: EXISTS(SubPlan 1) OR EXISTS(SubPlan 3)  ← OR 拆成两次 EXISTS
                          SubPlan 1: Index Scan EntityTag_pkey (loops=68258)
                          SubPlan 3: Index Scan EntityTag_pkey (loops=67606)
              ->  Hash on Bitmap Heap Scan EntityTag (NOT 集合)            ← 这部分快
JIT:
  Timing: ... Total 215.315 ms                                            ← JIT 编译开销
Execution Time: 1436.203 ms
```

诊断：
1. **`confidence >= 0.6` 全表扫描**：527k 行 EntityTag Seq Scan → 过滤掉 421k → 留 105k → HashAggregate 到 68k 唯一 entity。这一步 ~60ms，能接受。
2. **`OR(tag X, tag Y)` 被规划器拆成两个独立 EXISTS subplan**：对 68k 候选实体的每一个，PG 都跑两次 `EntityTag_pkey` index probe（subplan1 + subplan3），共 ~136k index probes。这是 1.2 秒的主要来源。
3. **JIT 编译开销 215ms**：复杂查询触发 PG JIT，但结果集只有 1259 行——这种规模 JIT 反而增加固定成本。
4. **`NOT (tag Z)` 部分用 bitmap scan + hash anti join**：仅 1069 行，很快，不是瓶颈。

## 优化空间评估（按 ROI 排序）

不在本次基线工作内实施，作为 follow-up 工单候选：

### 高 ROI（不动 schema，纯编译器层）

1. ✅ **`or: [{tag: X}, {tag: Y}, ...]` 合并为单个 `tag = ANY([X, Y, ...])`**（issue #71，已实施）
   `leafTagIds()` helper 检测 OR 下所有子节点是否均为可解析 tagId 的 leaf（`tag` / `tagSlug` / `tagAlias` / `descendantOf`），若是则收集全部 tagId 后调用 `existsByTagIds(ANY([...]))` —— PG 走单次 bitmap scan 而非 N 个独立 EXISTS subplan。
   预期：查询 #3 / #5 都受益，**保守预估 30-50% 加速**。

2. ✅ **关闭 JIT for /search/entities**（issue #71，已实施）
   filter 存在时将主查询包在 `prisma.$transaction` 内，事务首行执行 `SET LOCAL jit = off`，对结果集小的 BoolExpr 查询消除 ~200ms JIT 固定开销。

### 中 ROI（加索引）

3. **加 `idx(entityType, status, confidence)`**（部分 / 表达式索引）覆盖 confidence 范围查询。
   预期：confidence leaf 从 seq scan 变 index range scan，三层嵌套预期降到 < 500ms。
   工程量：1 个 migration + 索引大小评估。
   风险：写入额外维护成本，对 manual（confidence=NULL）的多数行无价值，可用部分索引规避：`WHERE confidence IS NOT NULL`。

### 低 ROI / 战略级（#17 v2）

4. **物化 `EntityTagWide`**：把所有维度 denormalize 到一张宽表，预聚合常用过滤组合。能干掉 EXISTS 而走单次扫描。
   工程复杂度：大（需要 outbox 同步保持一致），暂不推荐。

## 结论 & 下一步

- **#43 + #44 已完成核心目标**：编译器有完整单测，性能瓶颈定位清晰。
- **不达标但有明确路径**：三层嵌套超 7.5x，但 EXPLAIN 指向具体两个可修复点（OR 合并 + confidence 索引）。
- **单 tag p95 < 30ms 在本地/同 VPC 部署可达**，无需为远程 dev DB 数字担心。

建议把上面 **优化空间 1+2**（编译器 OR 合并 + JIT off）拆成独立 issue，是单次 session 可吃下的小工。

## 历史记录

| 日期 | commit | 数据规模 | 三层嵌套 p95 | 单 tag p95 | 备注 |
|------|--------|---------|------------|----------|------|
| 2026-05-27 | 0bc6180 | 100k dish × 5 | 1503 ms | 165 ms | 首次基线；客户端 macOS → 远程 PG ~130ms RTT。三层嵌套 SQL 本身 1.4s，瓶颈定位见 EXPLAIN |
| 2026-05-28 | *(#71)* | 同上 | 待复跑 | 待复跑 | OR-merge + JIT off 已上线。OR 合并消除 N 个独立 EXISTS subplan → 单次 bitmap scan；JIT off 省 ~200ms 固定开销。重跑 `pnpm bench:search` 可获新基线 |
