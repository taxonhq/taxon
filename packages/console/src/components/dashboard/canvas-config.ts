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
// 拖动对齐的细网格步长（px）。10 整除 UNIT，贴合平铺仍对齐；够细够顺，不再 55px 整格跳。
export const GRID = 10;

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
  | "trend-chart" | "entity-pie" | "activity-feed" | "health-bar"
  | "organism-legend";

/**
 * 背景有机体向上抛出的元信息，供「图谱图例」widget 消费。
 * 由 TagOrganism 按整屏容器算出（哪些分组在图中 / 用量区间 / 采样 N/M），
 * 保证图例与背景实际显示一致。
 */
export interface OrganismMeta {
  legend: { id: string; name: string; color: string; count: number }[];
  shown: number;
  total: number;
  usageMin: number;
  usageMax: number;
  hasStale: boolean;
  staleDays: number;
}

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
  // 图谱图例：背景有机体的颜色/大小/采样说明（从背景抽出为独立 widget）
  "organism-legend": { id: "organism-legend", labelKey: "organismLegend", allowed: ["2x2", "3x2", "2x3"],         defaultTpl: "2x2" },
};

export const ALL_WIDGET_IDS = Object.keys(WIDGET_DEFS) as WidgetId[];

/** 某 widget 是否允许某模板（切换尺寸时校验） */
export function isTemplateAllowed(id: string, tpl: TemplateKey): boolean {
  const def = WIDGET_DEFS[id as WidgetId];
  return !!def && def.allowed.includes(tpl);
}

// ── 固定舞台模型（v5）──────────────────────────────────────────────
// widget 不再钉锚点，而是在一块「固定虚拟舞台」里用绝对坐标 (x,y) 摆放；
// 渲染时把整块舞台**等比缩放居中**塞进视口（letterbox）。布局一次设计、
// 处处一样、永不重叠/溢出——小屏只是整体变小，不会塌成一坨。
export const STAGE = { w: 1440, h: 900 };

// ── 持久化布局项（与 lib/api.ts 的 DashboardWidget 同形）──────────────
export interface CanvasItem {
  i: WidgetId | string; // widget id
  tpl: TemplateKey;     // 当前模板
  x: number;            // 舞台坐标系左上角 X（虚拟像素）
  y: number;            // 舞台坐标系左上角 Y
}

export interface CanvasCamera { x: number; y: number; s: number }

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * widget 在舞台坐标系内的矩形（含夹取，保证不越出舞台边界）。
 * 渲染与拖动起点都用它，单一真源。防御 NaN（HMR 残留旧格式项）。
 */
export function itemRect(it: CanvasItem) {
  const { width, height } = templateSize(it.tpl);
  const x = Number.isFinite(it.x) ? it.x : 0;
  const y = Number.isFinite(it.y) ? it.y : 0;
  return {
    left: clampN(x, 0, Math.max(0, STAGE.w - width)),
    top:  clampN(y, 0, Math.max(0, STAGE.h - height)),
    width, height,
  };
}

/**
 * 舞台等比适配视口：整块舞台缩放系数 + 居中偏移（letterbox）。
 * scale 取宽/高两轴较小比例 → 舞台整体可见、保持长宽比、不裁剪。
 */
export function stageFit(size: { w: number; h: number }) {
  const scale = Math.min(size.w / STAGE.w, size.h / STAGE.h) || 1;
  const offX = (size.w - STAGE.w * scale) / 2;
  const offY = (size.h - STAGE.h * scale) / 2;
  return { scale, offX, offY };
}

/** AABB 矩形相交（留 1px 容差 → 边贴边不算重叠，可紧贴摆放）。 */
export function rectsOverlap(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  const eps = 1;
  return (
    a.left + a.width  > b.left + eps &&
    b.left + b.width  > a.left + eps &&
    a.top  + a.height > b.top  + eps &&
    b.top  + b.height > a.top  + eps
  );
}

/**
 * 布局版本：结构/单位/默认位置变更时旧布局自动失效，回落默认。
 * v1 → v2：UNIT 76→110，KPI 1×1→2×1，布局重排。
 * v2 → v3：图谱图例从背景抽出为独立 widget，加入默认布局。
 * v3 → v4：定位从分数坐标改为锚点模型（{ax,ay,dx,dy}），跨分辨率布局一致。
 * v4 → v5：定位改为固定舞台绝对坐标（{x,y}）+ 整层等比缩放适配，跨屏不重叠/不溢出。
 */
export const CANVAS_VERSION = 5;

/**
 * 默认布局（舞台坐标系，参照 STAGE = 1440×900；渲染时整体等比缩放居中）。
 * 全部坐标对齐 GRID(10)、互不重叠、留出右/下空白透出背景有机体。
 *
 *  ┌──────────────────────────────────────────────┐
 *  │ [分组][标签][实体][待审]                  [活动流] │
 *  │ [趋势曲线 4×2]  [实体环] [图谱图例]        [活动流] │
 *  │ [健康横幅 4×1]                                    │
 *  └──────────────────────────────────────────────┘
 */
export const DEFAULT_CANVAS: CanvasItem[] = [
  // ── 顶部 KPI 行：4 张 2×1 横排 ──
  { i: "stat-groups",     tpl: "2x1", x: 60,   y: 60  },
  { i: "stat-tags",       tpl: "2x1", x: 300,  y: 60  },
  { i: "stat-entities",   tpl: "2x1", x: 540,  y: 60  },
  { i: "stat-pending",    tpl: "2x1", x: 780,  y: 60  },
  // ── 内容带：趋势曲线 + 实体环 + 图谱图例 ──
  { i: "trend-chart",     tpl: "4x2", x: 60,   y: 200 },
  { i: "entity-pie",      tpl: "2x2", x: 520,  y: 200 },
  { i: "organism-legend", tpl: "2x2", x: 760,  y: 200 },
  // ── 右栏：活动流贴右、纵向长条 ──
  { i: "activity-feed",   tpl: "2x4", x: 1160, y: 60  },
  // ── 健康横幅：趋势下方 ──
  { i: "health-bar",      tpl: "4x1", x: 60,   y: 460 },
];

/** 缺省相机 */
export const DEFAULT_CAMERA: CanvasCamera = { x: 0, y: 0, s: 1 };
