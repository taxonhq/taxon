-- 关键词子串检索：metadata trigram 索引（issue #95）
--
-- BoolExpr 的 { "text": "<关键词>" } leaf 对 RegisteredEntity.metadata 的
-- name + description 做【子串】匹配（ILIKE '%kw%'）。本索引用 pg_trgm 的
-- gin_trgm_ops 加速 ILIKE，使 "鸡" 能命中 "宫保鸡丁"。
--
-- 为什么不用 to_tsvector 全文检索：'simple' 配置不对中文分词，整段 CJK 会被
-- 当作单个 token（'宫保鸡丁' 是一个词），而全文检索匹配的是整词、不是子串，
-- 于是 '鸡' 命中不了 '宫保鸡丁'。"名字/描述里包含关键词" 本质是子串查询，
-- trigram 才是对的工具。
--
-- ⚠ 索引的拼接表达式必须与 src/lib/search/compile.ts 中 text leaf 的拼接
--   表达式逐字一致（COALESCE / 顺序 / 空格），否则 planner 无法匹配该表达式索引。
--
-- 注：1~2 字的极短关键词 trigram 选择性低、可能退化为扫描，但结果始终正确。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "RegisteredEntity_metadata_trgm_idx"
ON "RegisteredEntity"
USING GIN (
  (COALESCE("metadata"->>'name', '') || ' ' || COALESCE("metadata"->>'description', '')) gin_trgm_ops
);
