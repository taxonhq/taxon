-- CreateTable: TagMergeLog
CREATE TABLE "TagMergeLog" (
    "id"              TEXT        NOT NULL,
    "targetTagId"     TEXT        NOT NULL,
    "sourceTagIds"    TEXT[]      NOT NULL,
    "entityTagsMoved" INTEGER     NOT NULL,
    "aliasesMoved"    INTEGER     NOT NULL,
    "mergedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagMergeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TagMoveLog
CREATE TABLE "TagMoveLog" (
    "id"          TEXT        NOT NULL,
    "tagId"       TEXT        NOT NULL,
    "fromGroupId" TEXT        NOT NULL,
    "toGroupId"   TEXT        NOT NULL,
    "tagsMoved"   INTEGER     NOT NULL,
    "movedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagMoveLog_pkey" PRIMARY KEY ("id")
);

-- Index: quick lookup by target/source
CREATE INDEX "TagMergeLog_targetTagId_idx" ON "TagMergeLog"("targetTagId");
CREATE INDEX "TagMoveLog_tagId_idx"        ON "TagMoveLog"("tagId");
