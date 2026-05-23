-- EntityTag 性能索引补齐（issue #12）
--
-- 1. (tagId, status)       — 加速 ALL 模式原始 SQL：
--      WHERE tagId = ANY(?) AND status = 'active'
--      让 PostgreSQL 能在索引内同时过滤两个条件，减少回表。
--
-- 2. (status, entityType)  — 加速审核队列：
--      WHERE status = ? [AND entityType = ?]
--      审核队列永远按 status 过滤，entityType 可选。
--      status 放前缀让等值查找命中索引区间，entityType 进一步缩小扫描范围。

CREATE INDEX "EntityTag_tagId_status_idx" ON "EntityTag"("tagId", "status");
CREATE INDEX "EntityTag_status_entityType_idx" ON "EntityTag"("status", "entityType");
