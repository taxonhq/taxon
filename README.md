# Taxon

[中文](README.zh-CN.md) | **English**

A standalone tagging microservice with a built-in management console — tag groups, entity tagging, AI-tag audit workflow, and a real-time dashboard.

## Highlights

- **Dashboard** — single-page overview of groups, tags, entities, pending reviews, top groups, entity-type distribution, and live service health
- **Tag groups & tags** — group tags into named dimensions with scope and cardinality rules
- **Entity tagging** — attach tags to any entity type from any service via REST
- **Per-entity-type override** — fine-tune `allowMultiple` on top of group defaults
- **Audit workflow** — AI/automated tags land in `pending`, humans approve or reject in batches
- **Bearer auth** — single-token gate today; per-role tokens on the roadmap
- **REST API** — full OpenAPI 3.0 spec served with Scalar UI at `/docs`
- **Management console** — Next.js admin UI for groups, tags, entities, and the audit queue

## Packages

| Package | Description | Port |
|---------|-------------|------|
| [`packages/service`](packages/service) | Hono + Prisma backend, PostgreSQL | `3300` |
| [`packages/console`](packages/console) | Next.js management UI | `3400` |

## Quick start

**Prerequisites:** Node.js 20+, pnpm, PostgreSQL 14+

```bash
# 1. Clone & install
git clone https://github.com/taxonhq/taxon.git
cd taxon
pnpm install

# 2. Configure the service
cp packages/service/.env.example packages/service/.env
# Edit DATABASE_URL (and optionally API_TOKEN, CORS_ORIGINS)

# 3. Run migrations
pnpm -F tag-service exec prisma migrate dev

# 4. Start service + console together
pnpm dev
```

Then open:

- Console — http://localhost:3400
- API docs — http://localhost:3300/docs
- Health   — http://localhost:3300/health

Docker Compose (service + PostgreSQL only):

```bash
docker-compose up
```

## Core concepts

| Entity | Purpose |
|--------|---------|
| **TagGroup**        | Named dimension container — e.g. `cuisine`, `dietary` |
| **Tag**             | A value within a group — e.g. `sichuan`, `vegan` |
| **RegisteredEntity** | An external entity that can be tagged (composite key `[entityType, entityId]`) |
| **EntityTag**       | The link between a tag and a registered entity, with `source`, `status`, `confidence` |
| **TagGroupEntityRule** | Per-entity-type override of `allowMultiple` |

API responses are uniform: `{ "code": 0, "data": ... }` on success, `{ "code": <status>, "message": "..." }` on error.

## API example

```bash
TOKEN="..."  # value of API_TOKEN

# Create a tag group
curl -X POST http://localhost:3300/tag-groups \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"cuisine","name":"Cuisine","allowMultiple":false}'

# Create a tag inside it
curl -X POST http://localhost:3300/tags \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"groupId":"<groupId>","name":"Sichuan"}'

# Tag an entity — registration is automatic
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId> \
  -H "Authorization: Bearer $TOKEN"

# AI-sourced tags land in `pending` and show up in the audit queue
curl -X POST http://localhost:3300/entities/dish/dish-001/tags/<tagId> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"ai","confidence":0.92}'
```

## Architecture

```
┌────────────────┐        ┌─────────────────────────────────┐
│  Your service  │──────▶ │  Taxon Service  :3300            │
│  (any language)│  REST  │  Hono · Prisma · PostgreSQL      │
└────────────────┘        └────────────┬─────────────────────┘
                                       │
                          ┌─────────────────────────────────┐
                          │  Taxon Console  :3400            │
                          │  Next.js admin UI                │
                          └─────────────────────────────────┘
```

## Documentation

- Interactive API reference — `/docs` (Scalar UI)
- OpenAPI spec — `/openapi.json`
- Engineering notes — [`CLAUDE.md`](CLAUDE.md)

## Contributing

Issues and pull requests welcome. See open [issues](https://github.com/taxonhq/taxon/issues) for the current roadmap.

## License

MIT
