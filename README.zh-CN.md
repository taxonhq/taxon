# Taxon

**中文** | [English](README.md)

[![CI](https://github.com/taxonhq/taxon/actions/workflows/ci.yml/badge.svg)](https://github.com/taxonhq/taxon/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Stack](https://img.shields.io/badge/Hono%20·%20Next.js%20·%20Prisma%20·%20PostgreSQL-2b2b2b.svg)

**你的产品缺的那一层标签后端。** 任意服务通过 REST 给任意实体打标,AI 推断的标签进人工审核队列复核,用可组合 DSL 跨维度检索,再通过带签名的 webhook 把变更推回业务方 —— 全部由一个 PostgreSQL 支撑的微服务承载,配一套画布优先的控制台,把你的标签体系渲染成一张**会生长的活网络**,而不是又一个 CRUD 表格。

<p align="center">
  <img src=".github/assets/dashboard-zh.png" alt="Taxon 仪表盘 —— 标签体系渲染为力导向的「标签有机体」" width="100%">
</p>

## 为什么需要 Taxon

大多数团队会在每个服务里重造一遍标签:临时拼的关联表、没有治理、没法查询"所有既辣又素的菜"、AI 生成的标签也无人复核。Taxon 是一层**独立、可复用的标签服务**,任何服务都能调用 —— 并自带一套真实标签体系该有的治理、检索与可视化。

## 功能特性

- **🌿 画布优先控制台** —— 「菌丝」设计语言,你的标签体系本身*即是*界面:一张由发光标签节点构成的力导向有机体,而非一墙表格。
- **🏷️ REST 打标任意实体** —— 任意服务/语言注册并给任意类型实体打标。复合主键 `[entityType, entityId]`,无跨库外键。
- **📐 维度与基数** —— 标签归入具名维度,按实体类型设作用域,并可**按实体类型**覆盖单选/多选。
- **🤖 AI 标签审核工作流** —— AI / 导入的标签初始为 `pending` 并带置信度;审核员单条或批量通过/拒绝,完整审核历史 + 一键撤销。
- **🔑 角色化 API Token** —— `reader` / `writer` / `reviewer` / `admin`,各带可选实体类型作用域。SHA-256 哈希存储,绝不留明文。
- **🔎 可组合检索 DSL** —— 单一端点,一棵跨标签**与**元数据的 `BoolExpr` 树:关键词(Postgres trigram)、子孙、别名、自然语言→DSL、透视,全部与标签过滤自动组合。
- **🕸️ 实体关系图谱** —— 以局部懒加载方式探索「标签↔实体」二部网络,另有覆盖全量的 WebGL「标签星系」宏观视图。
- **📡 Webhook(outbox + HMAC)** —— 把 `entity_tag.*` / `tag.*` / `tag_group.*` / `entity.*` 事件推给业务方,HMAC-SHA256 签名,指数退避重试,投递记录 + 手动重放。
- **📊 审核员仪表盘** —— 基于审核历史的人均工作量统计与团队榜单。
- **📖 完整 OpenAPI 3.0** —— 每个端点都有文档,`/docs` 提供交互式 Scalar 参考。

## 截图

| 标签分组与维度 | 跨维度检索 |
|---|---|
| [![标签分组](.github/assets/groups-zh.png)](.github/assets/groups-zh.png) | [![实体检索](.github/assets/search-zh.png)](.github/assets/search-zh.png) |
| 把标签归入带作用域的维度,配基数规则与行内使用度。 | 跨标签 + 元数据的可组合 `BoolExpr` 工作台,含自然语言、透视、原生 DSL。 |

## 包结构

| 包 | 说明 | 端口 |
|------|------|------|
| [`packages/service`](packages/service) | Hono + Prisma 后端,PostgreSQL | `3300` |
| [`packages/console`](packages/console) | Next.js 管理控制台 | `3400` |

## 快速开始

**前置要求:** Node.js 20+、pnpm、PostgreSQL 14+

```bash
# 1. 克隆并安装
git clone https://github.com/taxonhq/taxon.git
cd taxon
pnpm install

# 2. 配置 service
cp packages/service/.env.example packages/service/.env
# 编辑 DATABASE_URL（可选 API_TOKEN、CORS_ORIGINS）

# 3. 执行迁移
pnpm -F tag-service exec prisma migrate dev

# 4. 同时启动 service + console
pnpm dev
```

然后打开:

- 控制台 — http://localhost:3400
- API 文档 — http://localhost:3300/docs
- 健康检查 — http://localhost:3300/health

Docker Compose（service + PostgreSQL）:

```bash
docker-compose up
```

## 核心概念

| 实体 | 用途 |
|--------|------|
| **TagGroup**        | 具名维度容器 —— 如 `cuisine`、`dietary` |
| **Tag**             | 分组内的一个值 —— 如 `sichuan`、`vegan` |
| **RegisteredEntity** | 可被打标的外部实体（复合主键 `[entityType, entityId]`） |
| **EntityTag**       | 标签与实体的关联,带 `source`、`status`、`confidence` |
| **TagGroupEntityRule** | 按实体类型覆盖 `allowMultiple` |

API 响应统一:成功 `{ "code": 0, "data": ... }`,出错 `{ "code": <status>, "message": "..." }`。

## API 示例

```bash
TOKEN="..."  # API_TOKEN 的值

# 创建标签分组
curl -X POST http://localhost:3300/tag-groups \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"cuisine","name":"菜系","allowMultiple":false}'

# 在分组内创建标签
curl -X POST http://localhost:3300/tags \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"groupId":"<groupId>","name":"川菜"}'

# 给实体打标 —— 自动注册
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId> \
  -H "Authorization: Bearer $TOKEN"

# AI 来源标签进入 pending,出现在审核队列
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"ai","confidence":0.92}'
```

## 架构

```
┌────────────────┐   REST    ┌─────────────────────────────────┐
│   你的服务      │ ───────▶  │  Taxon Service  :3300            │
│  （任意语言）   │ ◀───────  │  Hono · Prisma · PostgreSQL      │
└────────────────┘  webhook  └────────────┬─────────────────────┘
                                          │
                             ┌─────────────────────────────────┐
                             │  Taxon Console  :3400            │
                             │  Next.js · 画布优先管理界面      │
                             └─────────────────────────────────┘
```

一切都留在 PostgreSQL 里 —— 全文检索(trigram)、关系图谱(自连接)、事件 outbox —— 无需运维 Elasticsearch、向量库或消息队列。

## 测试

service 有一套 vitest 测试,跑在真实 PostgreSQL 上。每次运行创建独立 schema、执行迁移,结束后删除。

```bash
# 指向任意一次性 Postgres（切勿用生产库）
export TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/taxon_test"

pnpm -F tag-service test         # 跑一次
pnpm -F tag-service test:watch   # watch 模式
```

CI（GitHub Actions）在每次 push 和 PR 上,用 Postgres service container 跑 service 测试,外加 typecheck 和 console lint/build。

## 文档

- 交互式 API 参考 — `/docs`（Scalar UI）
- OpenAPI 规范 — `/openapi.json`
- 工程笔记 — [`CLAUDE.md`](CLAUDE.md)

## 贡献

欢迎 issue 和 PR。当前路线图见 open [issues](https://github.com/taxonhq/taxon/issues)。如果 Taxon 对你有用,点个 ⭐ 能帮更多人发现它。

## 许可证

MIT
