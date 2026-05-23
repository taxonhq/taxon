-- CreateTable: SystemConfig
-- 通用键值存储，用于保存系统级配置（如仪表盘布局）。
CREATE TABLE "SystemConfig" (
    "key"       TEXT        NOT NULL,
    "value"     JSONB       NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);
