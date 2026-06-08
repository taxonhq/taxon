-- #149: 用结构化字段 isRevert 取代 note='撤销' 魔法字符串判定撤销
ALTER TABLE "EntityTagReview" ADD COLUMN "isRevert" BOOLEAN NOT NULL DEFAULT false;

-- 回填历史数据：旧的撤销记录靠 note='撤销' 标记，迁移时一次性置位，保证统计连续
UPDATE "EntityTagReview" SET "isRevert" = true WHERE "note" = '撤销';
