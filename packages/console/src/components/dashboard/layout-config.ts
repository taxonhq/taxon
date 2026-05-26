/**
 * Dashboard 网格配置
 *
 * 设计规则（严格数学约束）：
 *  - 16/12/8 列网格（响应式），1U = 160px，行高 80px
 *  - 仅 5 种尺寸预设，纵横比严格 1:1 / 2:1 / 1:2 / 2:2
 *  - 每个 widget 只能在配置的 preset 之间切换（禁止自由 resize）
 *
 * 版本号变更时旧布局自动失效，回落到 DEFAULT_LAYOUT。
 */

import type { LayoutItem } from "react-grid-layout/legacy";

export const LAYOUT_VERSION = 8;

// ── 响应式断点配置 ─────────────────────────────────────────────────────
// 视口宽度 → 列数映射（支持窄屏 / 笔电）
export const BREAKPOINTS = {
  xl: 1920,  // ≥ 1920 → 16 列
  lg: 1280,  // ≥ 1280 → 12 列
  md: 0,     // < 1280 → 8 列
} as const;

export const COLS_CONFIG = {
  xl: 16,
  lg: 12,
  md: 8,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

// 兼容旧代码的默认值（16 列）
export const COLS    = 16;
export const ROW_H   = 80;
export const MARGIN: [number, number] = [24, 24];
export const PAD:    [number, number] = [40, 40];
export const CANVAS_W = 2880;

// 根据视口宽度获取断点
export function getBreakpoint(width: number): BreakpointKey {
  if (width >= BREAKPOINTS.xl) return "xl";
  if (width >= BREAKPOINTS.lg) return "lg";
  return "md";
}

// 根据断点获取列数
export function getCols(bp: BreakpointKey): number {
  return COLS_CONFIG[bp];
}

// 根据断点计算画布宽度
export function getCanvasWidth(bp: BreakpointKey): number {
  const cols = COLS_CONFIG[bp];
  return cols * 160 + PAD[0] * 2 + MARGIN[0] * (cols - 1);
}

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

// ── 中等断点布局（12 列）───────────────────────────────────────────────
export const DEFAULT_LAYOUT_LG: LayoutItem[] = [
  // Row 0-1: 4 张统计小卡
  { i: "stat-groups",   x:  0, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-tags",     x:  2, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-entities", x:  4, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-pending",  x:  6, y: 0, ...SIZE_PRESETS.SQ },
  // 活动流移到第二行
  { i: "activity-feed", x:  8, y: 0, ...SIZE_PRESETS.TALL },
  // Row 2-3: KPI + 趋势
  { i: "kpi-hero",      x:  0, y: 2, ...SIZE_PRESETS.HERO },
  { i: "trend-chart",   x:  4, y: 2, ...SIZE_PRESETS.HERO },
  { i: "entity-pie",    x:  8, y: 2, ...SIZE_PRESETS.HERO },
  // Row 4-5: 健康条
  { i: "health-bar",    x:  0, y: 6, ...SIZE_PRESETS.REC },
];

// ── 小断点布局（8 列，堆叠）─────────────────────────────────────────────
export const DEFAULT_LAYOUT_MD: LayoutItem[] = [
  // Row 0: 4 张统计小卡横排
  { i: "stat-groups",   x:  0, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-tags",     x:  2, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-entities", x:  4, y: 0, ...SIZE_PRESETS.SQ },
  { i: "stat-pending",  x:  6, y: 0, ...SIZE_PRESETS.SQ },
  // Row 2: KPI + 趋势
  { i: "kpi-hero",      x:  0, y: 2, ...SIZE_PRESETS.HERO },
  { i: "trend-chart",   x:  4, y: 2, ...SIZE_PRESETS.HERO },
  // Row 4: 实体分布
  { i: "entity-pie",    x:  0, y: 6, ...SIZE_PRESETS.HERO },
  // Row 6: 活动流
  { i: "activity-feed", x:  0, y: 8, ...SIZE_PRESETS.HERO },
  // Row 10: 健康条
  { i: "health-bar",    x:  0, y: 12, ...SIZE_PRESETS.REC },
];

// 根据断点获取默认布局
export function getDefaultLayout(bp: BreakpointKey): LayoutItem[] {
  switch (bp) {
    case "xl": return DEFAULT_LAYOUT;
    case "lg": return DEFAULT_LAYOUT_LG;
    case "md": return DEFAULT_LAYOUT_MD;
  }
}

// ── 工具：获取 widget 当前 preset key ─────────────────────────────────
export function currentPreset(item: LayoutItem): SizeKey | null {
  const allowed = WIDGET_PRESETS[item.i] ?? [];
  return allowed.find(k => SIZE_PRESETS[k].w === item.w && SIZE_PRESETS[k].h === item.h) ?? null;
}
