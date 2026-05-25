-- Migration: 20260525000000_audit_pending_index
-- 为审核队列的常见查询 (WHERE status = 'pending' ORDER BY createdAt DESC)
-- 添加联合索引，避免大表下的全表排序 (filesort)。
-- 同时优化 (tagId, status) 查询复用已有索引以减少冗余。

CREATE INDEX CONCURRENTLY IF NOT EXISTS "EntityTag_status_createdAt_idx"
  ON "EntityTag" ("status", "createdAt" DESC);
