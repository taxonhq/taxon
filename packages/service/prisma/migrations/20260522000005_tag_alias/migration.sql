-- 标签别名表：同一 tag 的多种表达形式（如 "麻辣" = "spicy" = "辣"）

CREATE TABLE "TagAlias" (
  "id"        TEXT         NOT NULL,
  "tagId"     TEXT         NOT NULL,
  "alias"     TEXT         NOT NULL,
  "source"    TEXT         NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TagAlias_pkey" PRIMARY KEY ("id")
);

-- FK：tag 删除时级联删除所有别名
ALTER TABLE "TagAlias" ADD CONSTRAINT "TagAlias_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 同一 tag 内 alias 唯一（跨 tag 的同 group 唯一性由应用层校验）
CREATE UNIQUE INDEX "TagAlias_tagId_alias_key" ON "TagAlias"("tagId", "alias");

-- 别名反查索引（resolve 接口用）
CREATE INDEX "TagAlias_alias_idx" ON "TagAlias"("alias");
