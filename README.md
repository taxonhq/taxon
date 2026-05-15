# Taxon

[中文](README.zh-CN.md) | **English**

A standalone, reusable tagging microservice with a built-in management console.

## Features

- **Tag Groups** — Organize tags into named groups with scope and cardinality rules
- **Entity Tagging** — Attach tags to any entity type from any service
- **Per-entity-type Rules** — Override `allowMultiple` per entity type within a group
- **Audit Workflow** — AI/automated tags land in `pending` state, humans approve or reject
- **Soft Delete** — Tags and groups are soft-deleted; unique constraints are freed via suffix
- **REST API** — Full OpenAPI 3.0 spec with interactive docs via Scalar UI
- **Management Console** — Next.js admin UI for groups, tags, and the audit queue

## Packages

| Package | Description | Port |
|---------|-------------|------|
| [`packages/service`](packages/service) | Hono + Prisma backend | 3300 |
| [`packages/console`](packages/console) | Next.js management UI | 3400 |

## Quick Start

**Prerequisites:** Node.js 20+, pnpm, PostgreSQL

```bash
# 1. Clone
git clone https://github.com/taxonhq/taxon.git
cd taxon

# 2. Install dependencies
pnpm install

# 3. Configure service
cp packages/service/.env.example packages/service/.env
# Edit DATABASE_URL in packages/service/.env

# 4. Run migrations
cd packages/service
npx prisma migrate dev
cd ../..

# 5. Start both service and console
pnpm dev
```

Or use Docker Compose (service only):

```bash
docker-compose up
```

## API

Once running, visit `http://localhost:3300/docs` for the interactive API reference.

### Core Concepts

- **TagGroup** — A named group of tags (e.g. `cuisine`, `dietary`)
- **Tag** — A value within a group (e.g. `sichuan`, `vegan`)
- **EntityTag** — A link between a tag and an entity from your system
- **RegisteredEntity** — An entity registered with Taxon so it can be tagged

### Example

```bash
# Create a tag group
curl -X POST http://localhost:3300/tag-groups \
  -H "Content-Type: application/json" \
  -d '{"slug":"cuisine","name":"Cuisine","allowMultiple":false}'

# Create a tag
curl -X POST http://localhost:3300/tags \
  -H "Content-Type: application/json" \
  -d '{"groupId":"<groupId>","name":"Sichuan"}'

# Register an entity
curl -X POST http://localhost:3300/entities/dish/dish-001

# Tag the entity
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId>
```

## Architecture

```
┌────────────────┐        ┌─────────────────────────────────┐
│  Your Service  │──────▶ │  Taxon Service  :3300           │
│  (any language)│        │  Hono + Prisma + PostgreSQL      │
└────────────────┘        └─────────────────────────────────┘
                                        │
                          ┌─────────────────────────────────┐
                          │  Taxon Console  :3400           │
                          │  Next.js management UI          │
                          └─────────────────────────────────┘
```

## License

MIT
