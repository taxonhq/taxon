-- Add review fields to EntityTag
ALTER TABLE "EntityTag" ADD COLUMN "reviewerId"     TEXT;
ALTER TABLE "EntityTag" ADD COLUMN "reviewNote"     TEXT;
ALTER TABLE "EntityTag" ADD COLUMN "previousStatus" "TagStatus";

-- EntityTagReview: full audit trail for every status change
CREATE TABLE "EntityTagReview" (
  "id"         TEXT          NOT NULL,
  "tagId"      TEXT          NOT NULL,
  "entityType" TEXT          NOT NULL,
  "entityId"   TEXT          NOT NULL,
  "reviewerId" TEXT,
  "fromStatus" "TagStatus"   NOT NULL,
  "toStatus"   "TagStatus"   NOT NULL,
  "note"       TEXT,
  "reviewedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntityTagReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EntityTagReview"
  ADD CONSTRAINT "EntityTagReview_entityTag_fkey"
  FOREIGN KEY ("tagId", "entityType", "entityId")
  REFERENCES "EntityTag"("tagId", "entityType", "entityId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntityTagReview"
  ADD CONSTRAINT "EntityTagReview_reviewer_fkey"
  FOREIGN KEY ("reviewerId")
  REFERENCES "ApiToken"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "EntityTagReview_tagId_entityType_entityId_reviewedAt_idx"
  ON "EntityTagReview"("tagId", "entityType", "entityId", "reviewedAt");

CREATE INDEX "EntityTagReview_reviewerId_reviewedAt_idx"
  ON "EntityTagReview"("reviewerId", "reviewedAt");
