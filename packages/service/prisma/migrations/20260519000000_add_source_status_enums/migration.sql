-- CreateEnum (幂等，已存在则跳过)
DO $$ BEGIN
  CREATE TYPE "TagSource" AS ENUM ('manual', 'ai', 'system', 'import');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TagStatus" AS ENUM ('active', 'pending', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: 先移除默认值，再转换类型，最后重新设置默认值
ALTER TABLE "EntityTag"
  ALTER COLUMN "source" DROP DEFAULT,
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "EntityTag"
  ALTER COLUMN "source" TYPE "TagSource" USING "source"::"TagSource",
  ALTER COLUMN "status" TYPE "TagStatus" USING "status"::"TagStatus";

ALTER TABLE "EntityTag"
  ALTER COLUMN "source" SET DEFAULT 'manual'::"TagSource",
  ALTER COLUMN "status" SET DEFAULT 'active'::"TagStatus";
