-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('manual', 'ai', 'system', 'import');

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('active', 'pending', 'rejected');

-- AlterTable: convert existing string columns to enum types
ALTER TABLE "EntityTag"
  ALTER COLUMN "source" TYPE "TagSource"
    USING "source"::"TagSource",
  ALTER COLUMN "source" SET DEFAULT 'manual'::"TagSource",
  ALTER COLUMN "status" TYPE "TagStatus"
    USING "status"::"TagStatus",
  ALTER COLUMN "status" SET DEFAULT 'active'::"TagStatus";
