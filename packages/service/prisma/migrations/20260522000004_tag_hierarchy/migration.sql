-- 标签层级：parentId 自引用 + 物化路径（path/depth）

ALTER TABLE "Tag" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Tag" ADD COLUMN "path"     TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tag" ADD COLUMN "depth"    INTEGER NOT NULL DEFAULT 0;

-- 自引用 FK
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 索引
CREATE INDEX "Tag_groupId_parentId_idx" ON "Tag"("groupId", "parentId");
CREATE INDEX "Tag_path_idx"             ON "Tag"("path");

-- 存量数据 backfill：所有现有标签均为根节点，depth=0，path=/<slug>/
UPDATE "Tag" SET "path" = '/' || "slug" || '/';
