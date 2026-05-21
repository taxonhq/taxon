-- Taxon baseline migration — tables already applied via raw SQL on 2026-05-18
-- Marked as applied with: prisma migrate resolve --applied 20260518000000_init

-- CreateTable
CREATE TABLE IF NOT EXISTS "RegisteredEntity" (
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegisteredEntity_pkey" PRIMARY KEY ("entityType","entityId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EntityTag" (
    "tagId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityTag_pkey" PRIMARY KEY ("tagId","entityType","entityId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TagGroup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityScopes" TEXT[],
    "allowMultiple" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "TagGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TagGroupEntityRule" (
    "groupId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "allowMultiple" BOOLEAN NOT NULL,
    CONSTRAINT "TagGroupEntityRule_pkey" PRIMARY KEY ("groupId","entityType")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RegisteredEntity_entityType_idx" ON "RegisteredEntity"("entityType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EntityTag_entityType_entityId_idx" ON "EntityTag"("entityType","entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EntityTag_entityType_entityId_status_idx" ON "EntityTag"("entityType","entityId","status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EntityTag_tagId_idx" ON "EntityTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_groupId_slug_key" ON "Tag"("groupId","slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_groupId_name_key" ON "Tag"("groupId","name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TagGroup_slug_key" ON "TagGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TagGroup_name_key" ON "TagGroup"("name");

-- AddForeignKey
-- 注意：PostgreSQL 不支持 ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS。
-- 使用 DO 块按 information_schema 检查 + 条件创建，确保 idempotent。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'EntityTag_tagId_fkey' AND table_name = 'EntityTag') THEN
    ALTER TABLE "EntityTag" ADD CONSTRAINT "EntityTag_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'EntityTag_entityType_entityId_fkey' AND table_name = 'EntityTag') THEN
    ALTER TABLE "EntityTag" ADD CONSTRAINT "EntityTag_entityType_entityId_fkey"
      FOREIGN KEY ("entityType","entityId") REFERENCES "RegisteredEntity"("entityType","entityId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'Tag_groupId_fkey' AND table_name = 'Tag') THEN
    ALTER TABLE "Tag" ADD CONSTRAINT "Tag_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'TagGroupEntityRule_groupId_fkey' AND table_name = 'TagGroupEntityRule') THEN
    ALTER TABLE "TagGroupEntityRule" ADD CONSTRAINT "TagGroupEntityRule_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
