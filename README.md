# Taxon

[中文](README.zh-CN.md) | **English**

[![CI](https://github.com/taxonhq/taxon/actions/workflows/ci.yml/badge.svg)](https://github.com/taxonhq/taxon/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Stack](https://img.shields.io/badge/Hono%20·%20Next.js%20·%20Prisma%20·%20PostgreSQL-2b2b2b.svg)

**The tagging backend your product is missing.** Tag any entity from any service over REST, review AI-suggested tags in a human audit queue, query across dimensions with a composable DSL, and push changes to your services via signed webhooks — all behind one PostgreSQL-backed microservice and a canvas-first console that renders your taxonomy as a *living network*, not another CRUD grid.

<p align="center">
  <img src=".github/assets/dashboard-en.png" alt="Taxon dashboard — your tag taxonomy rendered as a living, force-directed organism" width="100%">
</p>

## Why Taxon

Most teams reinvent tagging inside every service: ad-hoc join tables, no governance, no way to query "all dishes that are spicy **and** vegan", and no human review for AI-generated labels. Taxon is a **standalone, reusable tagging layer** any service can call — with the governance, search, and visualization a real taxonomy needs.

## Features

- **🌿 Canvas-first console** — a "mycelial" design where your taxonomy *is* the interface: a force-directed organism of glowing tag nodes, not a wall of tables.
- **🏷️ Tag anything over REST** — register and tag entities of any type from any service or language. Composite key `[entityType, entityId]`, no cross-DB foreign keys.
- **📐 Dimensions & cardinality** — group tags into named dimensions, scope them to entity types, and override single/multi-select **per entity type**.
- **🤖 AI-tag audit workflow** — AI / imported tags land in `pending` with a confidence score; reviewers approve or reject (single or batch), with full review history and one-click undo.
- **🔑 Role-based API tokens** — `reader` / `writer` / `reviewer` / `admin`, each with optional entity-type scopes. SHA-256 hashed, never stored in plaintext.
- **🔎 Composable search DSL** — one endpoint, a `BoolExpr` tree over tags **and** metadata: keyword (Postgres trigram), descendant, alias, natural-language → DSL, and pivot — all auto-composing with tag filters.
- **🕸️ Entity relationship graph** — explore the bipartite tag↔entity network with local, lazy-loaded expansion, plus a WebGL "tag galaxy" macro view for the whole space.
- **📡 Webhooks (outbox + HMAC)** — push `entity_tag.*` / `tag.*` / `tag_group.*` / `entity.*` events to your services, HMAC-SHA256 signed, with exponential-backoff retries, a delivery log, and manual replay.
- **📊 Reviewer dashboard** — per-reviewer workload stats and a team leaderboard, built on the audit history.
- **📖 Full OpenAPI 3.0** — every endpoint documented, served as an interactive Scalar reference at `/docs`.

## Screenshots

| Tag groups & dimensions | Cross-dimension search |
|---|---|
| [![Tag groups](.github/assets/groups-en.png)](.github/assets/groups-en.png) | [![Entity search](.github/assets/search-en.png)](.github/assets/search-en.png) |
| Group tags into scoped dimensions with cardinality rules and inline usage. | A composable `BoolExpr` workbench over tags + metadata, NL, pivot, and raw DSL. |

## Packages

| Package | Description | Port |
|---------|-------------|------|
| [`packages/service`](packages/service) | Hono + Prisma backend, PostgreSQL | `3300` |
| [`packages/console`](packages/console) | Next.js management console | `3400` |

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

Docker Compose (service + PostgreSQL):

```bash
docker-compose up
```

## Core concepts

| Entity | Purpose |
|--------|---------|
| **TagGroup**        | Named dimension container — e.g. `cuisine`, `dietary` |
| **Tag**             | A value within a group — e.g. `sichuan`, `vegan` |
| **RegisteredEntity** | An external entity that can be tagged (composite key `[entityType, entityId]`) |
| **EntityTag**       | The link between a tag and an entity, with `source`, `status`, `confidence` |
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
┌────────────────┐   REST    ┌─────────────────────────────────┐
│  Your services │ ───────▶  │  Taxon Service  :3300            │
│  (any language)│ ◀───────  │  Hono · Prisma · PostgreSQL      │
└────────────────┘  webhooks └────────────┬─────────────────────┘
                                          │
                             ┌─────────────────────────────────┐
                             │  Taxon Console  :3400            │
                             │  Next.js · canvas-first admin UI │
                             └─────────────────────────────────┘
```

Everything stays in PostgreSQL — full-text search (trigram), the relationship graph (self-joins), and the event outbox — so there's no Elasticsearch, vector DB, or message broker to operate.

## Testing

The service has a vitest suite that runs against a real PostgreSQL database. Each run provisions an isolated schema, applies migrations, and drops it on teardown.

```bash
# Point at any throwaway Postgres (NOT production)
export TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/taxon_test"

pnpm -F tag-service test         # run once
pnpm -F tag-service test:watch   # watch mode
```

CI (GitHub Actions) runs the service tests against a Postgres service container, plus typecheck and a console lint/build, on every push and pull request.

## Documentation

- Interactive API reference — `/docs` (Scalar UI)
- OpenAPI spec — `/openapi.json`
- Engineering notes — [`CLAUDE.md`](CLAUDE.md)

## Contributing

Issues and pull requests welcome. See open [issues](https://github.com/taxonhq/taxon/issues) for the current roadmap. If Taxon is useful to you, a ⭐ helps others find it.

## License

MIT
