/**
 * Dashboard 画布配置（菌丝 v2 · 单一画布 · 模板化漂浮 widget）
 *
 * 设计模型（取代旧 react-grid-layout 网格吸附，见 refinement-2026-06 §6 supersede）：
 *  - 有机体 = 唯一的「大地」背景，铺满视口、可 pan/zoom 探索
 *  - widget = 漂浮在大地之上的玻璃仪表，自由摆放
 *  - 尺寸 = 离散「模板」W×H 个单位（不是任意 resize）；每个 widget 按内容声明
 *    支持哪些模板 + 默认哪档；大数字 / 曲线图自然用更宽的模板
 *  - 位置 = 画布内的分数坐标 [0,1]（与分辨率无关，跨屏按比例落点 + 渲染时夹取）
 */

// 1 个模板单位的像素尺寸（@scale=1）。相机缩放在此之上再乘 scale。
// 110px：2×1 KPI = 220×110，4×2 趋势 = 440×220，视觉上不再像邮票。
export const UNIT = 110;
// widget 之间落点轻吸附的网格步长（= 半个单位，对齐但不死板）
export const SNAP = UNIT / 2;

export type TemplateKey = string; // 形如 "2x1"（w×h，单位数）

export interface Template { w: number; h: number }

/** 解析 "2x1" → { w:2, h:1 } */
export function parseTemplate(key: TemplateKey): Template {
  const [w, h] = key.split("x").map(Number);
  return { w: w || 1, h: h || 1 };
}

/** 模板像素尺寸（@scale=1） */
export function templateSize(key: TemplateKey): { width: number; height: number } {
  const { w, h } = parseTemplate(key);
  return { width: w * UNIT, height: h * UNIT };
}

/**
 * 模板目录（调色板用）。竖向/横向/大曲线档齐全。
 * 曲线图天生要横向展开，故补 4×2 / 6×2 / 8×2 / 6×3 / 8×4 宽档。
 */
export const TEMPLATE_CATALOG: TemplateKey[] = [
  "1x1", "2x1", "1x2", "2x2", "1x4", "2x4",
  "4x1", "4x2", "6x2", "8x2", "6x3", "8x4",
];

// ── widget 类型目录 ────────────────────────────────────────────────────
// id 复用既有 renderWidget 的 key，保证渲染分发不变。
export type WidgetId =
  | "stat-groups" | "stat-tags" | "stat-entities" | "stat-pending"
  | "trend-chart" | "entity-pie" | "activity-feed" | "health-bar";

export interface WidgetDef {
  id: WidgetId;
  /** i18n：dashboard.widgetLabels.<labelKey> */
  labelKey: string;
  /** 该 widget 支持的模板档（第一个为推荐默认） */
  allowed: TemplateKey[];
  defaultTpl: TemplateKey;
}

export const WIDGET_DEFS: Record<WidgetId, WidgetDef> = {
  // 单指标 KPI：统一 2×1（220×110px）。1×1 太小（110px 方块像邮票），保留作可切换档。
  "stat-groups":   { id: "stat-groups",   labelKey: "statGroups",   allowed: ["2x1", "1x1"],                    defaultTpl: "2x1" },
  "stat-tags":     { id: "stat-tags",     labelKey: "statTags",     allowed: ["2x1", "1x1"],                    defaultTpl: "2x1" },
  "stat-entities": { id: "stat-entities", labelKey: "statEntities", allowed: ["2x1", "1x1"],                    defaultTpl: "2x1" },
  "stat-pending":  { id: "stat-pending",  labelKey: "statPending",  allowed: ["2x1", "1x1"],                    defaultTpl: "2x1" },
  // 曲线 / 趋势：可大可小，大曲线模板供详读
  "trend-chart":   { id: "trend-chart",   labelKey: "trendChart",   allowed: ["2x1", "4x2", "6x2", "8x2", "6x3", "8x4"], defaultTpl: "4x2" },
  // 环形分布：方形为主
  "entity-pie":    { id: "entity-pie",    labelKey: "entityPie",    allowed: ["2x2", "4x2", "2x4"],             defaultTpl: "2x2" },
  // 活动流：纵向滚动，高档更耐看
  "activity-feed": { id: "activity-feed", labelKey: "activityFeed", allowed: ["2x2", "2x4", "2x6"],             defaultTpl: "2x4" },
  // 服务健康：横幅
  "health-bar":    { id: "health-bar",    labelKey: "healthBar",    allowed: ["4x1", "2x1", "2x2"],             defaultTpl: "4x1" },
};

export const ALL_WIDGET_IDS = Object.keys(WIDGET_DEFS) as WidgetId[];

/** 某 widget 是否允许某模板（切换尺寸时校验） */
export function isTemplateAllowed(id: string, tpl: TemplateKey): boolean {
  const def = WIDGET_DEFS[id as WidgetId];
  return !!def && def.allowed.includes(tpl);
}

// ── 持久化布局项（与 lib/api.ts 的 DashboardWidget 同形） ──────────────
export interface CanvasItem {
  i: WidgetId | string; // widget id
  tpl: TemplateKey;     // 当前模板
  x: number;            // 左上角分数坐标 [0,1]（画布宽）
  y: number;            // 左上角分数坐标 [0,1]（画布高）
}

export interface CanvasCamera { x: number; y: number; s: number }

/**
 * 布局版本：结构/单位/默认位置变更时旧布局自动失效，回落默认。
 * v1 → v2：UNIT 76→110，KPI 1×1→2×1，布局重排。
 */
export const CANVAS_VERSION = 2;

/**
 * 默认布局（基准：1440×900 视口，UNIT=110）。
 *
 * 分区原则：
 *  ┌──────────────────────────────────────┐
 *  │  [KPI 2×2网格]      有机体中心       [活动流] │
 *  │  [趋势曲线4×2]                       [实体环] │
 *  │                [健康横幅4×1]                   │
 *  └──────────────────────────────────────┘
 *
 *  左侧：KPI 4 张（2列×2行）+ 趋势曲线；中心空留有机体；
 *  右侧：活动流（高竖条）+ 实体环；下方：健康横幅居中。
 *
 *  x/y 均为左上角分数坐标 [0,1]。
 *  左边距 0.055（≈79px）刚好避开 spine（74px）。
 *  右侧 0.84（≈1210px）+ 220px = 1430px < 1440px。
 */
export const DEFAULT_CANVAS: CanvasItem[] = [
  // ── 左上 KPI 簇：2列 × 2行，分数间距约 0.16（220px / 1440）──
  { i: "stat-groups",   tpl: "2x1", x: 0.055, y: 0.11 },
  { i: "stat-tags",     tpl: "2x1", x: 0.215, y: 0.11 },
  { i: "stat-entities", tpl: "2x1", x: 0.055, y: 0.24 },
  { i: "stat-pending",  tpl: "2x1", x: 0.215, y: 0.24 },
  // ── 左中 趋势曲线（4×2 = 440×220px）────────────────────────
  { i: "trend-chart",   tpl: "4x2", x: 0.055, y: 0.52 },
  // ── 右侧 活动流（2×4 = 220×440px，避开右上状态簇）──────────
  { i: "activity-feed", tpl: "2x4", x: 0.840, y: 0.11 },
  // ── 右下 实体环（2×2 = 220×220px）──────────────────────────
  { i: "entity-pie",    tpl: "2x2", x: 0.840, y: 0.63 },
  // ── 下中 健康横幅（4×1 = 440×110px）────────────────────────
  { i: "health-bar",    tpl: "4x1", x: 0.375, y: 0.83 },
];

/** 缺省相机 */
export const DEFAULT_CAMERA: CanvasCamera = { x: 0, y: 0, s: 1 };
