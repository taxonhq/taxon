# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Taxon is a standalone tagging microservice with a management console. It provides tag groups, entity tagging, audit workflow for AI-generated tags, and a REST API with OpenAPI documentation.

## Monorepo Structure

- `packages/service` — Hono + Prisma backend (port 3300)
- `packages/console` — Next.js management UI (port 3400)

## Development Commands

```bash
# Install dependencies
pnpm install

# Run both service and console
pnpm dev

# Run individually
pnpm dev:service
pnpm dev:console

# Build all packages
pnpm build

# Database setup (first time)
cp packages/service/.env.example packages/service/.env
cd packages/service && npx prisma migrate dev

# Docker Compose (service + postgres)
docker-compose up
```

## Core Architecture

### Data Model (Prisma Schema)

Five models with specific relationships:

1. **TagGroup** — Dimension container (e.g., "cuisine", "dietary")
   - `entityScopes`: Allowed entity types (empty = universal)
   - `allowMultiple`: Default cardinality rule
   - Soft deletes with `deletedAt`; slug/name suffixed on deletion to free unique constraints

2. **Tag** — Value within a group (e.g., "sichuan", "vegan")
   - Unique slug/name per group via composite constraints `[groupId, slug]` and `[groupId, name]`
   - Cascades to EntityTag on deletion

3. **RegisteredEntity** — Tracks external entities that can be tagged
   - Composite key: `[entityType, entityId]`
   - Business services register entities before tagging
   - Cascades to EntityTag on unregistration

4. **EntityTag** — Core linking table; composite key `[tagId, entityType, entityId]`
   - `source`: "manual" | "ai" | "system" | "import"
   - `status`: "active" | "pending" | "rejected"
   - AI tags default to `pending` for human review; `confidence` (0–1) is set only for AI sources

5. **TagGroupEntityRule** — Overrides `allowMultiple` per entity type
   - Example: "cuisine" group allows multiple tags for "dining" but single tag for "dish"

### API Response Format

All endpoints return:
- Success: `{ code: 0, data: ... }`
- Error: `{ code: <statusCode>, message: "..." }`

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/tag-groups` | List (paginated) / create groups |
| GET/PATCH/DELETE | `/tag-groups/:id` | Group CRUD; soft delete |
| GET | `/tag-groups/:id/tags` | Tags in group (paginated) |
| PUT | `/tag-groups/:id/entity-rules` | Full-replace entity-type rules |
| GET/POST | `/tags` | List (paginated) / create tags |
| GET/PATCH/DELETE | `/tags/:id` | Tag CRUD; soft delete |
| POST/DELETE/GET | `/entities/:type/:id` | Register / unregister / check entity |
| GET/PUT | `/entities/:type/:id/tags` | Get or replace all tags (`?status=all\|pending`) |
| POST/PATCH/DELETE | `/entities/:type/:id/tags/:tagId` | Add / update / remove single tag |
| GET | `/entities/audit` | Pending tags with filters (`?status`, `?entityType`, pagination) |
| GET | `/entity-types` | All registered entity types with counts |
| GET | `/openapi.json` | OpenAPI 3.0 spec |
| GET | `/docs` | Scalar UI interactive reference |

`DELETE` endpoints on tag groups and tags accept `?force=true` to bypass the "in-use" check (409 otherwise).

### Soft Delete Pattern

When deleting tags or tag groups, the route only sets the `deletedAt` timestamp; `slug` and `name` are preserved as-is.

Uniqueness on `slug` / `[groupId, slug]` / `[groupId, name]` is enforced by **PostgreSQL partial unique indexes** with `WHERE "deletedAt" IS NULL`, so soft-deleted rows do not occupy the active namespace and can coexist (multiple deleted records with the same original slug are allowed). Prisma's schema language can't express partial indexes, so the indexes are maintained by migration `20260521000000_soft_delete_partial_unique_index` — do **not** re-add `@unique` / `@@unique` on those columns.

### Slug Generation

The `generateSlug()` function in `packages/service/src/lib/slug.ts` handles:
- Chinese characters → pinyin conversion
- English text → lowercase, hyphenated
- Fallback to timestamp if empty

Manually provided slugs must match `/^[a-z0-9][a-z0-9_-]*$/` (max 100 chars). Auto-generated slugs append a random suffix on collision.

### Pagination

Standard pagination in `packages/service/src/lib/pagination.ts`:
- Default page size: 20
- Max page size: 100
- Returns `{ items, total, page, pageSize }`

## Service Package (`packages/service`)

### Route Organization

Routes are organized by resource:
- `src/routes/tag-groups.ts` — TagGroup CRUD + entity rules
- `src/routes/tags.ts` — Tag CRUD
- `src/routes/entities.ts` — Entity registration, tagging, audit queue

### Key Validation

The `validateTags()` function in `entities.ts` enforces:
1. Tag existence (excluding soft-deleted)
2. `entityScopes` compatibility
3. `allowMultiple` constraint (entity-type rule takes precedence over group default)

Single-tag additions use a transaction to check `allowMultiple` and prevent race conditions.

### Error Handling

In `src/lib/errors.ts`:
- `isPrismaError(e, code)` — checks Prisma error codes (P2002 = unique constraint, P2025 = record not found)
- `ValidationError` — custom error with `statusCode` field
- `deletedSuffix()` — returns `__deleted__${Date.now().toString(36)}`

### OpenAPI Documentation

- Spec generated in `src/openapi.ts`
- Interactive docs at `/docs` using Scalar UI
- Spec endpoint at `/openapi.json`

### Environment Variables

Located in `packages/service/.env` (copy from `.env.example`):
- `DATABASE_URL` — PostgreSQL connection string
- `PORT` — Service port (default: 3300)
- `CORS_ORIGINS` — Comma-separated allowed origins (unset = allow all)

## Console Package (`packages/console`)

### Environment Variables

Located in `packages/console/.env.local`:
- `NEXT_PUBLIC_TAG_SERVICE_URL` — Backend URL (default: `http://localhost:3300`)

### API Client

All backend calls go through `src/lib/api.ts`:
- Typed wrapper around fetch; throws on `code !== 0`

### Pages

- `/groups` — TagGroup list and management
- `/groups/[groupId]` — Tag list within a group, entity-type rules editor
- `/audit` — Pending tag approvals (AI-generated tags); filter by status and entity type

## Database Migrations

```bash
cd packages/service

# Create and apply migration
npx prisma migrate dev --name description

# Apply migrations in production
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

## Important Patterns

### Entity-Type Level Override

When checking `allowMultiple`, always prioritize `TagGroupEntityRule` over `TagGroup.allowMultiple`:

```typescript
const effectiveAllowMultiple =
  tag.group.entityRules.length > 0
    ? tag.group.entityRules[0].allowMultiple
    : tag.group.allowMultiple
```

### Cascade Behavior

- Deleting a TagGroup → cascades to all Tags and EntityTags
- Deleting a Tag → cascades to all EntityTags
- Unregistering an entity → cascades to all EntityTags

Use `?force=true` query parameter on DELETE endpoints to force deletion even when related records exist.

### AI Tag Workflow

Tags from `source: "ai"` are created with `status: "pending"` and require human review via the audit queue (`/audit` in the console). The `confidence` field (0–1) is meaningful only for AI-sourced tags; it is `null` for all other sources.
