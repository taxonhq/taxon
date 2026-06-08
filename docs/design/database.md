# Taxon 数据库设计文档

> 版本: 1.0 | 日期: 2026-06-08 | 迁移数: 17 | 模型数: 15

---

## 一、设计原则

1. **字符串主键** — 全部用 `cuid()` 生成，分布式友好、无需中心序列
2. **复合主键优先** — 关联表用业务语义的复合键而非无意义自增 ID
3. **软删除 + 部分唯一索引** — 核心资源可恢复删除，deletedAt 不占 namespace
4. **物化路径 + 深度** — 标签层级用 path 字段替代递归 CTE，高效子树查询
5. **Outbox Pattern** — 业务操作与事件发布同事务，保证 at-least-once 语义
6. **审计日志去 FK** — 日志表用快照字段而非外键约束，保证记录可追溯后仍能删

---

## 二、ER 总览

```
┌─────────────────┐       ┌──────────────────┐       ┌──────────────────────┐
│    TagGroup     │──1:N──│       Tag        │──1:N──│      TagAlias        │
│  (标签维度/分组)  │       │   (标签值)        │       │    (标签别名)         │
│                 │       │                  │       │                      │
│  allowMultiple  │       │  parentId (自引用) │       │  @@unique([tagId,     │
│  entityScopes[] │       │  path (物化路径)   │       │    alias])           │
│  deletedAt      │       │  depth / sortOrder │       │                      │
│                 │       │  deletedAt        │       │                      │
└────────┬────────┘       └────────┬─────────┘       └──────────────────────┘
         │                        │
         │                ┌───────┴───────┐
         │                │               │
         │         1:N    │        1:N    │
┌────────┴────────────────┴┐      ┌──────┴──────────────┐
│  TagGroupEntityRule      │      │     EntityTag        │──1:N──│ EntityTagReview │
│  (分组-实体类型覆盖规则)    │      │   (核心关联表)        │       │  (审核历史)      │
│                          │      │                      │       │                 │
│  @@id([groupId,          │      │  source (enum)       │       │  fromStatus     │
│    entityType])          │      │  confidence          │       │  toStatus       │
│                          │      │  status (enum)       │       │  isRevert       │
└──────────────────────────┘      │                      │       │  reviewedAt     │
                                  └──────────┬───────────┘       └─────────────────┘
                                             │
                                             │ N:1
                                  ┌──────────┴───────────┐
                                  │   RegisteredEntity    │
                                  │   (实体登记簿)         │
                                  │                      │
                                  │  @@id([entityType,    │
                                  │    entityId])         │
                                  │  metadata (Json)     │
                                  └──────────────────────┘
```

### 辅助模型

```
┌──────────┐     ┌─────────────────┐     ┌──────────────┐
│ ApiToken │     │ TagMergeLog     │     │ TagMoveLog   │
│ (API密钥) │     │ (合并操作日志)    │     │ (迁移操作日志)  │
└──────────┘     └─────────────────┘     └──────────────┘

┌──────────┐     ┌─────────────────┐     ┌──────────────┐
│ Webhook  │──1:N──│ WebhookDelivery │     │ EventOutbox  │
│ (事件订阅) │     │ (投递记录)       │     │ (事件队列)    │
└──────────┘     └─────────────────┘     └──────────────┘

┌──────────────┐
│ SystemConfig │
│ (键值存储)    │
└──────────────┘
```

---

## 三、核心模型详解

### 3.1 TagGroup — 标签分组（维度）

**职责**: 对标签进行维度划分。一个分组 = 一个独立的标签命名空间。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String (cuid) | 主键 |
| `slug` | String | URL 友好标识，部分唯一索引（仅 active） |
| `name` | String | 显示名称，部分唯一索引（仅 active） |
| `entityScopes` | String[] | 允许的实体类型白名单；空 `[]` = 通用 |
| `allowMultiple` | Boolean | 默认：单实体是否可持有该分组多个标签 |
| `deletedAt` | DateTime? | 软删除时间戳 |

**约束**:
- `slug` 和 `name` 通过 PostgreSQL 部分唯一索引 `WHERE "deletedAt" IS NULL` 保证 active 记录唯一
- Prisma schema 无法表达 partial index，故不写 `@@unique`

**级联**: 删除分组 → CASCADE 删除所有标签 → CASCADE 删除所有 EntityTag

### 3.2 Tag — 标签

**职责**: 分组内的具体标签值。支持层级结构（parentId 自引用）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String (cuid) | 主键 |
| `groupId` | String | 所属分组 FK |
| `parentId` | String? | 父标签 FK（自引用，SetNull on delete） |
| `path` | String | 物化路径，格式 `slug1/slug2/`，无前导 `/` |
| `depth` | Int | 层级深度（根=0） |
| `sortOrder` | Int | 同级排序 |
| `deletedAt` | DateTime? | 软删除时间戳 |
| `slug` / `name` | String | 标识符/显示名，组内唯一 |

**层级设计（物化路径）**:
```
  parentId:          自引用 FK，直接定位父节点
  path:              物化路径 "cuisine/spicy/mala/"
  depth:             深度值 (0=根, 1=子, 2=孙...)

  查询所有子孙:  WHERE path LIKE 'cuisine/spicy/%' AND groupId = ?
  查询祖先:      从 path 逐级向上
  重命名:        UPDATE SET path = REPLACE(path, oldPrefix, newPrefix) WHERE groupId = ?
```

**设计决策**: 为什么用物化路径而不是 recursive CTE / adjacency list?
- 优势: 单次 LIKE 查询即可获取所有子孙，不需递归
- 劣势: 重命名祖先时需批量更新后代 path（由应用层 + 事务保证一致性）
- 陷阱: path 仅组内唯一，跨分组可能有同名路径 → 必须同时限定 `groupId`

**约束**:
- slug/name 同组内唯一（部分唯一索引 WHERE deletedAt IS NULL）
- 最大深度 5 层（应用层校验 MAX_DEPTH）
- slug 格式 `/^[a-z0-9][a-z0-9_-]*$/` 最大 100 字符

### 3.3 RegisteredEntity — 实体登记簿

**职责**: 外部业务实体的轻量登记。tag-service 对实体本身只有最小化认知。

| 字段 | 类型 | 说明 |
|------|------|------|
| `entityType` | String | 实体类型，如 `"dish"`, `"restaurant"` |
| `entityId` | String | 业务方的主键 (cuid) |
| `metadata` | Json? | 可选业务元数据（name, description, imageUrl...） |
| `registeredAt` | DateTime | 注册时间 |

**设计要点**:
- 复合主键 `[entityType, entityId]` — 同一 entityId 可在不同 entityType 下独立存在
- `metadata` 为 JSON，用于 AI suggest 的上下文输入和 ILIKE 子串检索
- 实体注销 → CASCADE 清除所有 EntityTag
- `entityId` 是无 FK 约束的字符串引用，调用方自行保证一致性

**索引**:
- `@@index([entityType])` — 按类型枚举实体
- `@@index([entityType])` + GIN trigram on metadata — 关键词子串检索 (pg_trgm)

### 3.4 EntityTag — 核心关联表

**职责**: 记录"哪个实体被打了哪个标签"，是整个服务的核心。

| 字段 | 类型 | 说明 |
|------|------|------|
| `tagId` | String | 标签 FK → Tag(id) CASCADE |
| `entityType` + `entityId` | String | 实体 FK → RegisteredEntity CASCADE |
| `source` | TagSource | manual / ai / system / import |
| `confidence` | Float? | AI 置信度 0–1，仅 AI 来源设值 |
| `status` | TagStatus | active / pending / rejected |
| `createdAt` | DateTime | 打标时间 |
| `reviewedAt` | DateTime? | 最后审核时间 |
| `reviewerId` | String? | 最后审核者 (ApiToken.id 软引用) |
| `reviewNote` | String? | 最后审核备注 |
| `previousStatus` | TagStatus? | 前一状态（供撤销参考） |

**设计要点**:
- 复合主键 `[tagId, entityType, entityId]` — 同标签不能重复打在同一实体上
- AI 标签默认 `status=pending`，进入审核队列
- 手动标签默认 `status=active`，即时生效
- `reviewerId` 为软引用（无 FK 约束），审核者 token 撤销后记录仍可追溯
- 审核历史独立存储为 `EntityTagReview`（而非内联到本表）

**索引策略**:
```
@@index([entityType, entityId])         — 查询某实体所有标签
@@index([entityType, entityId, status]) — 查询某实体的 active/pending 标签
@@index([tagId])                         — 查询某标签被哪些实体使用
@@index([tagId, status])                 — 查询某标签的 active 实体数
@@index([status, entityType])            — 按类型浏览审核队列
@@index([status, createdAt DESC])       — 审核队列分页
```

### 3.5 TagGroupEntityRule — 分组-实体类型覆盖规则

**职责**: 按实体类型覆盖 `TagGroup.allowMultiple` 的默认规则。

```
示例:
  菜系分组: allowMultiple = false
    └─ 对 dish:      allowMultiple = false  (默认，不需额外 rule)
    └─ 对 dining:    allowMultiple = true   (餐厅可以有多个菜系)
```

优先级: `entityRules 匹配` > `group.allowMultiple` 默认值

---

## 四、标签层级：物化路径详解

### 数据结构

```sql
-- 典型数据
id='t1', groupId='g1', parentId=null, slug='cuisine',  path='cuisine/',           depth=0
id='t2', groupId='g1', parentId='t1',  slug='spicy',    path='cuisine/spicy/',     depth=1
id='t3', groupId='g1', parentId='t2',  slug='mala',     path='cuisine/spicy/mala/', depth=2
```

### 操作语义

| 操作 | SQL / 逻辑 |
|------|-----------|
| 查子孙 | `WHERE groupId=? AND path LIKE 'cuisine/spicy/%' AND deletedAt IS NULL` |
| 查祖先 | `SELECT * FROM Tag WHERE id IN (SELECT parentId FROM Tag WHERE ...)` 循环查找 |
| 重命名 | `UPDATE Tag SET path = 'new/' \|\| substr(path, length('old/')+1) WHERE groupId=? AND path LIKE 'old/%'` |
| 移动 | 迁移到新分组: 全量重算新 parentId + path + depth; 子孙同步更新 groupId + path 前缀 |
| 合并 | 源标签 EntityTag + Alias 迁到目标; 源标签软删除 |

### 已知陷阱 (#146)

`path` 前缀查询必须同时限定 `groupId`，因为不同分组的标签可能有同名 slug → 相同 path。

```sql
-- ❌ 错误: 可能跨分组污染
WHERE path LIKE 'spicy/%'

-- ✅ 正确: 限定分组
WHERE groupId = ? AND path LIKE 'spicy/%'
```

重命名/移动时也同理，必须按 `groupId` 限定更新范围。

---

## 五、软删除模式

### 机制

```
┌─────────────────────────────────────────────────┐
│ PostgreSQL 部分唯一索引 (Partial Unique Index)     │
│                                                 │
│ CREATE UNIQUE INDEX Tag_groupId_slug_active_key  │
│   ON "Tag" ("groupId", "slug")                  │
│   WHERE "deletedAt" IS NULL;                    │
└─────────────────────────────────────────────────┘
```

**行为**:
- 软删除: `UPDATE SET deletedAt = NOW()` — slug/name 保持不变
- 已删除记录的 slug/name 不占用 active namespace
- 多个同名软删除记录可共存
- 恢复: `UPDATE SET deletedAt = NULL` — 如果 slug 仍唯一，成功

**适用模型**: `TagGroup`, `Tag`

---

## 六、审计与日志

### 6.1 EntityTagReview — 审核历史

```
EntityTag ──1:N── EntityTagReview
```

每次 `PATCH /entities/:type/:id/tags/:tagId` 修改状态时，写入一条 review 记录。

| 关键字段 | 说明 |
|---------|------|
| `fromStatus` / `toStatus` | 状态转换（pending→active / active→rejected / ...） |
| `isRevert` | 是否为撤销操作（替代旧版 note='撤销' 魔法字符串） |
| `note` | 人工备注 |
| `reviewerId` | 审核者 ApiToken.id（软引用，SetNull） |

**索引**: `[tagId, entityType, entityId, reviewedAt]`, `[reviewerId, reviewedAt]`

### 6.2 TagMergeLog / TagMoveLog — 操作日志

- **TagMergeLog**: 记录标签合并操作（哪些源标签 merge 到哪个目标）
- **TagMoveLog**: 记录标签跨分组迁移（含子孙节点数量）
- 两者均用**快照字段**（name/slug 副本）而非 FK，保证关联标签删除后日志仍可读

---

## 七、Webhook & 事件系统

### 架构

```
业务操作 (POST/PATCH/DELETE)
  │
  ├── 同事务 ── EventOutbox (事件写入)
  │
  ▼
Outbox Worker (轮询)
  │
  ├── 解析事件 → 匹配 Webhook subscriptions
  │
  ├── Fan-out → WebhookDelivery (per subscription)
  │
  ▼
Delivery Worker (发 HTTP + 重试)
  │
  ├── HMAC-SHA256 签名 (X-Taxon-Signature)
  ├── 指数退避重试 (最大 N 次)
  └── redirect: manual (SSRF 防护 #147)
```

### 关键表

| 表 | 职责 |
|----|------|
| `EventOutbox` | 业务-事件一致性边界；`publishedAt` 标记已处理 |
| `Webhook` | 注册信息：URL、events 白名单、entityType scopes、HMAC secret |
| `WebhookDelivery` | 每次投递的记录；status: pending/success/failed；nextRetryAt 调度 |

**一致性**: at-least-once（幂等性由消费端保证）

---

## 八、认证与 API Token

```
ApiToken
  ├── tokenHash: SHA-256(原始 token)，不存明文
  ├── role: ApiRole (reader < writer < reviewer < admin)
  ├── scopes: entityType 白名单
  ├── revokedAt: 撤销时间戳
  └── lastUsedAt: 最近使用时间（异步更新，60s 去抖）
```

**设计要点**:
- 原始 token 仅在创建时一次性返回
- 认证请求时比对 SHA-256 哈希
- 权限校验: route middleware 声明 `requireRole('admin')`
- 开发模式 bypass: 若无 `API_TOKEN` 环境变量且 DB 中无 token → 自动 admin
- `entityType` scope 仅对带 `entityType` 参数的操作生效

---

## 九、索引策略总表

| 表 | 索引 | 用途 |
|----|------|------|
| Tag | `[groupId]` | 分组下标签列表 |
| Tag | `[groupId, parentId]` | 查子节点 |
| Tag | `[path]` | 物化路径前缀查询 |
| Tag | _partial_ `[groupId, slug] WHERE deletedAt IS NULL` | slug 唯一约束 |
| Tag | _partial_ `[groupId, name] WHERE deletedAt IS NULL` | name 唯一约束 |
| TagGroup | _partial_ `[slug] WHERE deletedAt IS NULL` | slug 唯一约束 |
| TagGroup | _partial_ `[name] WHERE deletedAt IS NULL` | name 唯一约束 |
| EntityTag | `[entityType, entityId]` | 实体标签查询 |
| EntityTag | `[entityType, entityId, status]` | 带状态过滤的查询 |
| EntityTag | `[tagId]` | 标签使用量 |
| EntityTag | `[tagId, status]` | 活跃使用量 |
| EntityTag | `[status, entityType]` | 审核队列分类 |
| EntityTag | `[status, createdAt DESC]` | 审核队列分页 |
| EntityTagReview | `[tagId, entityType, entityId, reviewedAt]` | 标签审核历史 |
| EntityTagReview | `[reviewerId, reviewedAt]` | 审核员工作量 |
| EventOutbox | `[publishedAt, createdAt]` | Worker 轮询 |
| WebhookDelivery | `[status, nextRetryAt]` | Worker 取待投递 |
| WebhookDelivery | `[webhookId, createdAt DESC]` | Webhook 投递历史 |
| Webhook | `[active]` | 取活跃 Webhook |
| TagAlias | `[alias]` | 通过别名反查标签 |
| RegisteredEntity | `[entityType]` | 实体类型枚举 |
| _GIN_ | `RegisteredEntity(metadata name+description trigram)` | 关键词子串检索 (#95) |
| TagMoveLog | `[movedAt DESC]` | 操作历史 |
| TagMergeLog | `[mergedAt DESC]` | 操作历史 |

---

## 十、迁移历史

| # | 迁移 | 日期 | 内容 |
|----|------|------|------|
| 1 | `init` | 05-18 | 初始 schema: TagGroup, Tag, EntityTag, RegisteredEntity |
| 2 | `add_source_status_enums` | 05-19 | EntityTag 加 source/status 枚举 |
| 3 | `add_entity_tag_reviewed_at` | 05-19 | 审核时间/审核员字段 |
| 4 | `soft_delete_partial_unique_index` | 05-21 | 部分唯一索引替代 slug/name 直接 @@unique |
| 5 | `entity_tag_indexes` | 05-22 | EntityTag 查询索引 |
| 6 | `api_token` | 05-22 | ApiToken 模型 |
| 7 | `entity_tag_review` | 05-22 | EntityTagReview 审核历史 |
| 8 | `tag_hierarchy` | 05-22 | Tag.parentId + path + depth |
| 9 | `tag_alias` | 05-22 | TagAlias 标签别名 |
| 10 | `tag_merge_move_log` | 05-22 | TagMergeLog + TagMoveLog |
| 11 | `system_config` | 05-22 | SystemConfig 键值存储 |
| 12 | `audit_pending_index` | 05-25 | 审核队列专用索引 |
| 13 | `registered_entity_metadata` | 05-27 | RegisteredEntity.metadata (Json) |
| 14 | `enhance_log_snapshot_fields` | 05-27 | 日志表加 name/slug 快照字段 |
| 15 | `metadata_trgm_search` | 05-30 | pg_trgm GIN 索引加速 ILIKE |
| 16 | `webhooks_outbox` | 06-02 | Webhook + WebhookDelivery + EventOutbox |
| 17 | `entity_tag_review_is_revert` | 06-05 | EntityTagReview.isRevert 结构化工位 |

---

## 十一、已知问题 & 技术债务

### 11.1 数据完整性

| 问题 | 严重度 | 状态 |
|------|--------|------|
| `#146` 物化路径跨组污染 — path LIKE 未限定 groupId | P1 | ✅ 已修复 (待合并) |
| `#148` 日界聚合用 UTC date_trunc — 非 UTC 用户日期错位 | P2 | ✅ 已修复 (待合并) |
| 标签层级最大深度 (5) 仅为应用层校验，DB 无约束 | 低 | 接受 |

### 11.2 查询性能

| 问题 | 说明 |
|------|------|
| `descendantOf` 搜索 | 先解析标签 ID 再 JOIN，无直接索引优化。大量子孙时可能慢 |
| 审核队列 `ORDER BY createdAt DESC` | 已设专用索引 `[status, createdAt DESC]` — 性能 OK |
| `#97` 语义搜索 | 评估 pgvector embedding 替代/增强 ILIKE 子串匹配 |

### 11.3 Schema 设计

| 问题 | 说明 |
|------|------|
| `EntityTag.reviewerId` | 与 `EntityTagReview` 有字段冗余。审核状态变更时两边都要更新 |
| `ApiToken.scopes` | 用 String[] 存储，PostgreSQL array 查询效率一般。高频场景考虑拆分多行 |
| `SystemConfig` | 仅 key-value，无 namespace/concurrency/ttl 支持。仅用于简单配置 |
| `registeredAt` vs `createdAt` | 实体注册用 `registeredAt` 而 EntityTag 用 `createdAt` — 命名不统一 |

### 11.4 索引冗余

| 冗余组合 | 说明 |
|---------|------|
| `[entityType, entityId]` + `[entityType, entityId, status]` | 后者可覆盖前者的大部分查询 (leftmost prefix) |
| `[tagId]` + `[tagId, status]` | 同上 |

这些冗余是**有意的** — Prisma 不支持 index hints，保留更具体的索引以避免 planner 选择错误。

---

## 十二、规模估算

基于 perf seed 数据 (100K entities, 10K tags, 500K entity-tags):

| 操作 | 估计性能 |
|------|---------|
| `GET /entities/:type/:id/tags` (5 tags) | < 5ms |
| `GET /entities/audit?status=pending` (分页 20) | < 50ms |
| `POST /entities/bulk-tag` (100 entities) | < 500ms |
| `GET /tags/:id/descendants` (100 子孙) | < 20ms |
| `POST /search/entities` (3 条件 AND) | < 200ms |
| Webhook fan-out (10 webhooks × 100 events) | < 5s |

---

## 附录: 术语对照

| DB 模型 | API / UI 术语 |
|---------|-------------|
| TagGroup | 分组 |
| Tag | 标签 |
| EntityTag | 标签关联 |
| RegisteredEntity | 实体 |
| allowMultiple | 基数规则 |
| confidence | 置信度 |
| EntityTagReview | 审核记录 |
