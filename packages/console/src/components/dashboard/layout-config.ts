/**
 * Dashboard 网格配置
 *
 * 设计规则（严格数学约束）：
 *  - 16 列网格，1U = 160px，行高 80px
 *  - 仅 5 种尺寸预设，纵横比严格 1:1 / 2:1 / 1:2 / 2:2
 *  - 每个 widget 只能在配置的 preset 之间切换（禁止自由 resize）
 *
 * 版本号变更时旧布局自动失效，回落到 DEFAULT_LAYOUT。
 */

import type { LayoutItem } from "react-grid-layout/legacy";

export const LAYOUT_VERSION = 7;

export const COLS    = 16;
export const ROW_H   = 80;
export const MARGIN: [number, number] = [24, 24];
export const PAD:    [number, number] = [40, 40];
export const CANVAS_W = 2880;

// ── 尺寸预设 ──────────────────────────────────────────────────────────
export type SizeKey = "SQ" | "REC" | "TALL" | "HERO" | "JUMBO";

export const SIZE_PRESETS: Record<SizeKey, { w: number; h: number; label: string; tip: string }> = {
  SQ:    { w: 2, h: 2, label: "小",   tip: "2×2 小方块" },
  REC:   { w: 4, h: 2, label: "宽",   tip: "4×2 横长" },
  TALL:  { w: 2, h: 4, label: "高",   tip: "2×4 竖长" },
  HERO:  { w: 4, h: 4, label: "大",   tip: "4×4 主卡" },
  JUMBO: { w: 6, h: 4, label: "巨",   tip: "6×4 巨型" },
};

// ── 每个 widget 的允许尺寸 ────────────────────────────────────────────
export const WIDGET_PRESETS: Record<string, SizeKey[]> = {
  "kpi-hero":      ["HERO", "JUMBO"],
  "entity-pie":    ["HERO", "JUMBO"],
  "trend-chart":   ["JUMBO", "HERO"],
  "stat-groups":   ["SQ"],
  "stat-tags":     ["SQ"],
  "stat-entities": ["SQ"],
  "stat-pending":  ["SQ"],
  "activity-feed": ["TALL", "HERO"],
  "health-bar":    ["REC", "HERO"],
};

export const WIDGET_LABELS: Record<string, string> = {
  "kpi-hero":      "核心指标",
  "entity-pie":    "实体类型分布",
  "trend-chart":   "趋势对比 · 7 天",
  "stat-groups":   "标签分组",
  "stat-tags":     "标签总数",
  "stat-entities": "已注册实体",
  "stat-pending":  "待审核",
  "activity-feed": "最近活动",
  "health-bar":    "服务健康",
};

// ── 默认布局（16 列 × 8 行，无需滚动可见）─────────────────────────────
// 视觉权重：左侧 HERO 主 KPI + 右侧 PIE 环形图 = 双 hero 平衡
// 顶部 stat 卡 4 张排成 1 行，底部趋势图横跨 + 活动流竖侧
export const DEFAULT_LAYOUT: LayoutItem[] = [
  // ── Row 0-1: 4 张统计小卡（顶部，SQ 2×2）
  { i: "stat-groups",   x:  0, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-tags",     x:  2, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-entities", x:  4, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-pending",  x:  6, y: 0, ...SIZE_PRESETS.SQ },
  // ── Row 0-3 右侧：活动流 (TALL 2×4)
  { i: "activity-feed", x:  8, y: 0, ...SIZE_PRESETS.TALL },
  // ── Row 0-3 远右：实体分布 (HERO 4×4)
  { i: "entity-pie",    x: 10, y: 0, ...SIZE_PRESETS.HERO },
  // ── Row 2-5 左：KPI Hero (HERO 4×4)
  { i: "kpi-hero",      x:  0, y: 2, ...SIZE_PRESETS.HERO },
  // ── Row 2-5 中：趋势图 (HERO 4×4)
  { i: "trend-chart",   x:  4, y: 2, ...SIZE_PRESETS.HERO },
  // ── Row 4-5：服务健康条 (REC 4×2)，在活动流下面
  { i: "health-bar",    x:  8, y: 4, ...SIZE_PRESETS.REC },
];

// ── 工具：获取 widget 当前 preset key ─────────────────────────────────
export function currentPreset(item: LayoutItem): SizeKey | null {
  const allowed = WIDGET_PRESETS[item.i] ?? [];
  return allowed.find(k => SIZE_PRESETS[k].w === item.w && SIZE_PRESETS[k].h === item.h) ?? null;
}
