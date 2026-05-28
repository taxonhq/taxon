-- AlterTable: Add snapshot fields to TagMergeLog
ALTER TABLE "TagMergeLog" ADD COLUMN "targetTagName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagMergeLog" ADD COLUMN "targetTagSlug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagMergeLog" ADD COLUMN "targetGroupSlug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagMergeLog" ADD COLUMN "sourceTagNames" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable: Add snapshot fields to TagMoveLog
ALTER TABLE "TagMoveLog" ADD COLUMN "tagName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagMoveLog" ADD COLUMN "tagSlug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagMoveLog" ADD COLUMN "fromGroupSlug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagMoveLog" ADD COLUMN "toGroupSlug" TEXT NOT NULL DEFAULT '';

-- CreateIndex: Add indexes for audit queries
CREATE INDEX "TagMergeLog_mergedAt_idx" ON "TagMergeLog"("mergedAt" DESC);
CREATE INDEX "TagMoveLog_mergedAt_idx" ON "TagMoveLog"("movedAt" DESC);

-- DropIndex: Remove old index if exists (named differently in original migration)
-- Original was "TagMergeLog_targetTagId_idx" and "TagMoveLog_tagId_idx"
-- These are now defined in schema @@index directives
