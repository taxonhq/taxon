-- API Token 角色化（issue #2）
-- 新增 ApiRole enum 和 ApiToken 表，实现服务级 API Key + 三级权限分离。

CREATE TYPE "ApiRole" AS ENUM ('reader', 'writer', 'reviewer', 'admin');

CREATE TABLE "ApiToken" (
  "id"         TEXT        NOT NULL,
  "name"       TEXT        NOT NULL,
  "tokenHash"  TEXT        NOT NULL,
  "role"       "ApiRole"   NOT NULL,
  "scopes"     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt"  TIMESTAMP(3),

  CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
