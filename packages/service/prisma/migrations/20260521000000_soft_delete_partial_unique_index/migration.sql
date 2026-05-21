-- 软删除方案重构（issue #1）
--
-- 旧方案：软删除时给 slug/name 追加 `__deleted__<ts>` 后缀，
--         以腾出 [groupId, slug] / slug 唯一约束的名字空间。
-- 问题：  TOCTOU 竞态、后缀可能冲突、软删除记录污染名字空间、数据不干净。
--
-- 新方案：把唯一约束改为 PostgreSQL 部分唯一索引（partial unique index），
--         只对未删除（deletedAt IS NULL）的行生效。软删除记录不再占用名字空间，
--         因此不再需要后缀 hack。
--
-- 注意：Prisma schema 无法表达 partial unique index，schema.prisma 中已移除
--       对应的 @unique / @@unique，并加注释说明索引由本迁移维护。

-- ── 1. 数据回填：还原历史软删除记录被 hack 追加的后缀 ──────────────
-- 旧记录的 slug/name 形如 "sichuan__deleted__lq3x9a"，去掉后缀还原原值。
-- 仅作用于软删除记录（deletedAt IS NOT NULL），不会与活跃记录冲突，
-- 因为 partial unique index 只约束 deletedAt IS NULL 的行。

UPDATE "Tag"
SET "slug" = regexp_replace("slug", '__deleted__.*$', ''),
    "name" = regexp_replace("name", '__deleted__.*$', '')
WHERE "deletedAt" IS NOT NULL;

UPDATE "TagGroup"
SET "slug" = regexp_replace("slug", '__deleted__.*$', ''),
    "name" = regexp_replace("name", '__deleted__.*$', '')
WHERE "deletedAt" IS NOT NULL;

-- ── 2. 删除旧的全量唯一索引 ────────────────────────────────────────
DROP INDEX IF EXISTS "Tag_groupId_slug_key";
DROP INDEX IF EXISTS "Tag_groupId_name_key";
DROP INDEX IF EXISTS "TagGroup_slug_key";
DROP INDEX IF EXISTS "TagGroup_name_key";

-- ── 3. 创建部分唯一索引（仅约束未删除记录）────────────────────────
-- 命名沿用 Prisma 的 `<table>_<cols>_key` 习惯，加 `_active` 表明是部分索引。

CREATE UNIQUE INDEX "Tag_groupId_slug_active_key"
  ON "Tag" ("groupId", "slug")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Tag_groupId_name_active_key"
  ON "Tag" ("groupId", "name")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "TagGroup_slug_active_key"
  ON "TagGroup" ("slug")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "TagGroup_name_active_key"
  ON "TagGroup" ("name")
  WHERE "deletedAt" IS NULL;
