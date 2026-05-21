# Taxon

**中文** | [English](README.md)

一个独立的标签微服务，自带管理控制台 —— 标签分组、实体打标、AI 标签审核工作流，以及实时仪表盘。

## 核心能力

- **仪表盘** — 单页概览：分组数、标签数、已注册实体、待审核数、热门分组、实体类型分布、服务健康状态
- **标签分组与标签** — 把标签组织到具名维度，支持作用域与基数规则
- **实体打标** — 业务服务通过 REST 给任意实体类型挂标签
- **实体类型级覆盖** — 在分组默认值之上，按实体类型单独调整 `allowMultiple`
- **审核工作流** — AI / 自动来源的标签初始为 `pending`，人工批量通过或拒绝
- **Bearer 鉴权** — 当前为单令牌守卫，多角色 token 已纳入路线图
- **REST API** — 完整 OpenAPI 3.0 规范，Scalar UI 提供交互文档（`/docs`）
- **管理控制台** — 基于 Next.js 的管理界面，覆盖分组、标签、实体、审核四个核心场景

## 包结构

| 包 | 说明 | 端口 |
|----|------|------|
| [`packages/service`](packages/service) | Hono + Prisma 后端，PostgreSQL | `3300` |
| [`packages/console`](packages/console) | Next.js 管理界面 | `3400` |

## 快速开始

**前置要求：** Node.js 20+、pnpm、PostgreSQL 14+

```bash
# 1. 克隆 & 安装依赖
git clone https://github.com/taxonhq/taxon.git
cd taxon
pnpm install

# 2. 配置服务
cp packages/service/.env.example packages/service/.env
# 编辑 DATABASE_URL（可选 API_TOKEN、CORS_ORIGINS）

# 3. 执行数据库迁移
pnpm -F tag-service exec prisma migrate dev

# 4. 同时启动 service 与 console
pnpm dev
```

启动后访问：

- 控制台 — http://localhost:3400
- API 文档 — http://localhost:3300/docs
- 健康检查 — http://localhost:3300/health

使用 Docker Compose 启动（仅 service + PostgreSQL）：

```bash
docker-compose up
```

## 核心概念

| 实体 | 作用 |
|------|------|
| **TagGroup（标签分组）** | 维度容器 —— 例如 `cuisine`、`dietary` |
| **Tag（标签）** | 分组内的具体值 —— 例如 `sichuan`、`vegan` |
| **RegisteredEntity（已注册实体）** | 可被打标的外部实体（复合键 `[entityType, entityId]`） |
| **EntityTag（实体标签）** | 标签与实体之间的关联，带 `source`、`status`、`confidence` |
| **TagGroupEntityRule（实体类型规则）** | 按实体类型覆盖 `allowMultiple` |

API 响应统一格式：成功 `{ "code": 0, "data": ... }`，失败 `{ "code": <status>, "message": "..." }`。

## API 示例

```bash
TOKEN="..."  # API_TOKEN 的值

# 创建标签分组
curl -X POST http://localhost:3300/tag-groups \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"cuisine","name":"菜系","allowMultiple":false}'

# 在分组下创建标签
curl -X POST http://localhost:3300/tags \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"groupId":"<groupId>","name":"川菜"}'

# 给实体打标 —— 实体会被自动注册
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId> \
  -H "Authorization: Bearer $TOKEN"

# AI 来源的标签会落到 pending 状态，自动进入审核队列
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"ai","confidence":0.92}'
```

## 架构

```
┌────────────────┐        ┌─────────────────────────────────┐
│  业务服务       │──────▶ │  Taxon Service  :3300            │
│  （任意语言）   │  REST  │  Hono · Prisma · PostgreSQL      │
└────────────────┘        └────────────┬─────────────────────┘
                                       │
                          ┌─────────────────────────────────┐
                          │  Taxon Console  :3400            │
                          │  Next.js 管理界面                │
                          └─────────────────────────────────┘
```

## 测试

后端服务有一套 vitest 测试，跑在真实 PostgreSQL 上。
每次运行会创建独立 schema、应用迁移，结束后自动清除。

```bash
# 指向任意一次性 Postgres（不要用生产库）
export TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/taxon_test"

pnpm -F tag-service test         # 运行一次
pnpm -F tag-service test:watch   # 监听模式
```

CI（GitHub Actions）在每次 push / PR 时，针对 Postgres service container
运行后端测试，并执行类型检查与控制台的 lint / build。

## 相关文档

- 交互式 API 文档 —— `/docs`（Scalar UI）
- OpenAPI 规范 —— `/openapi.json`
- 工程说明 —— [`CLAUDE.md`](CLAUDE.md)

## 参与贡献

欢迎提交 Issue 和 Pull Request。查看 [open issues](https://github.com/taxonhq/taxon/issues) 了解当前路线图。

## 许可证

MIT
