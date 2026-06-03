/**
 * Dashboard 主页（菌丝 v2 · 单一画布）
 *
 * 极薄编排层：拉数据 → 渲染全屏「画布」。
 * 形态唯一——有机体即大地，监控 widget 漂浮其上、模板化、可自由排布。
 * 删除了旧的「正常 / 全屏」双模式、盒子 hero、react-grid-layout 网格。
 *
 * 业务逻辑下沉：
 *   - components/dashboard/use-dashboard-data   数据 hook
 *   - components/dashboard/dashboard-canvas     画布 + 漂浮 widget + 编辑交互
 *   - components/dashboard/widgets              各 widget 组件（模板自适应）
 *   - components/dashboard/canvas-config        模板目录 / 默认布局 / 坐标
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import { DashboardCanvas } from "@/components/dashboard/dashboard-canvas";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const [editing, setEditing] = useState(false);

  // 编辑态暂停自动刷新（避免数据跳变干扰拖拽）
  const { data, loading, refreshing, updatedAt, refresh } = useDashboardData({
    autoRefreshMs: 10_000,
    paused: editing,
  });

  if (loading || !data) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: "var(--myc-soil)" }}>
        <div className="text-center space-y-3">
          <div className="relative mx-auto w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: "var(--myc-line)" }} />
            <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: "var(--myc-dim)" }} />
          </div>
          <p className="text-xs tracking-wider" style={{ color: "var(--myc-dim)" }}>{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0" style={{ background: "var(--myc-soil)" }}>
      <DashboardCanvas
        data={data}
        refreshing={refreshing}
        reloadToken={updatedAt?.getTime() ?? 0}
        onRefresh={refresh}
        onEditingChange={setEditing}
      />
    </div>
  );
}
