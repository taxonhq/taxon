# Taxon

**中文** | [English](README.md)

一个独立、可复用的标签微服务，内置管理控制台。

## 功能特性

- **标签组** — 将标签组织到具名分组中，支持作用域和基数规则
- **实体打标** — 从任意服务为任意实体类型挂载标签
- **实体类型级规则** — 在分组内按实体类型单独覆盖 `allowMultiple`（是否允许多标签）
- **审核工作流** — AI / 自动化产生的标签初始为 `pending` 状态，由人工审批或拒绝
- **软删除** — 标签与标签组均为软删除，通过后缀释放唯一约束，可随时重建
- **REST API** — 完整的 OpenAPI 3.0 规范，配备 Scalar UI 交互文档
- **管理控制台** — 基于 Next.js 的管理界面，涵盖标签组、标签及审核队列

## 包结构

| 包 | 说明 | 端口 |
|----|------|------|
| [`packages/service`](packages/service) | Hono + Prisma 后端服务 | 3300 |
| [`packages/console`](packages/console) | Next.js 管理界面 | 3400 |

## 快速开始

**前置要求：** Node.js 20+、pnpm、PostgreSQL

```bash
# 1. 克隆仓库
git clone https://github.com/taxonhq/taxon.git
cd taxon

# 2. 安装依赖
pnpm install

# 3. 配置服务
cp packages/service/.env.example packages/service/.env
# 编辑 packages/service/.env 中的 DATABASE_URL

# 4. 执行数据库迁移
cd packages/service
npx prisma migrate dev
cd ../..

# 5. 同时启动服务与控制台
pnpm dev
```

或使用 Docker Compose 启动服务（仅后端）：

```bash
docker-compose up
```

## API

服务启动后，访问 `http://localhost:3300/docs` 查看交互式 API 参考文档。

### 核心概念

- **TagGroup（标签组）** — 标签的命名容器（例如 `cuisine`、`dietary`）
- **Tag（标签）** — 标签组内的具体值（例如 `sichuan`、`vegan`）
- **EntityTag（实体标签）** — 标签与业务实体之间的关联记录
- **RegisteredEntity（已注册实体）** — 在 Taxon 中完成注册、可被打标的实体

### 使用示例

```bash
# 创建标签组
curl -X POST http://localhost:3300/tag-groups \
  -H "Content-Type: application/json" \
  -d '{"slug":"cuisine","name":"菜系","allowMultiple":false}'

# 创建标签
curl -X POST http://localhost:3300/tags \
  -H "Content-Type: application/json" \
  -d '{"groupId":"<groupId>","name":"川菜"}'

# 注册实体
curl -X POST http://localhost:3300/entities/dish/dish-001

# 为实体打标
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId>
```

## 架构

```
┌────────────────┐        ┌─────────────────────────────────┐
│  业务服务       │──────▶ │  Taxon Service  :3300           │
│  （任意语言）   │        │  Hono + Prisma + PostgreSQL      │
└────────────────┘        └─────────────────────────────────┘
                                        │
                          ┌─────────────────────────────────┐
                          │  Taxon Console  :3400           │
                          │  Next.js 管理界面               │
                          └─────────────────────────────────┘
```

## 许可证

MIT
