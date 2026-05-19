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
ALTER TABLE "EntityTag" ADD CONSTRAINT IF NOT EXISTS "EntityTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityTag" ADD CONSTRAINT IF NOT EXISTS "EntityTag_entityType_entityId_fkey"
    FOREIGN KEY ("entityType","entityId") REFERENCES "RegisteredEntity"("entityType","entityId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT IF NOT EXISTS "Tag_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagGroupEntityRule" ADD CONSTRAINT IF NOT EXISTS "TagGroupEntityRule_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "TagGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
