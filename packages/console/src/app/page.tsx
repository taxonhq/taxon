"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ReactGridLayout, { type LayoutItem } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import Link from "next/link";
import {
  Layers, Box, ClipboardCheck, Tag,
  RefreshCw, AlertTriangle, CheckCircle2,
  ChevronRight, TrendingUp, LayoutGrid, Check, GripHorizontal,
  ArrowRight,
} from "lucide-react";
import {
  getTagGroups, getEntityTypes, getAuditItems, getHealth,
  getDashboardLayout, saveDashboardLayout,
  type HealthInfo, type PersistedDashboardLayout,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── 类型 ───────────────────────────────────────────────────────────────────

interface Stats { groups: number; tags: number; entities: number; pending: number }
interface EntityTypeStat { entityType: string; count: number }
interface GroupStat { id: string; name: string; tags: number }
interface DashData {
  stats: Stats;
  entityTypes: EntityTypeStat[];
  topGroups: GroupStat[];
  health: HealthInfo | null;
}

// ─── 布局版本控制（版本号变化时自动重置旧布局）────────────────────────────
const LAYOUT_VERSION = 6;

// ─── 画布配置 ────────────────────────────────────────────────────────────────
// 横向流动式 dashboard，参考 macOS / iOS Widget 风格：
// - 卡片尺寸有大有小（2×3 / 3×3 / 3×5 / 4×5 / 5×3）
// - 不严格对齐基线，垂直方向有意错落形成"飘浮"感
// - 大间距增强呼吸感
const COLS    = 14;
const ROW_H   = 70;
const MARGIN: [number, number] = [20, 20];   // 大间距 → 流动感
const PAD:    [number, number] = [40, 40];
const CANVAS_W = 2800;

// ─── 尺寸预设（像 iOS Widget 的 S/M/L）────────────────────────────────────
type SizeKey = "S" | "M" | "W" | "T" | "L";
const SIZE_PRESETS: Record<SizeKey, { w: number; h: number; label: string }> = {
  S: { w: 2, h: 3, label: "小" },   // 方块（stat 卡专用）
  M: { w: 3, h: 3, label: "中" },   // 中方块
  W: { w: 4, h: 3, label: "宽" },   // 横长条
  T: { w: 3, h: 5, label: "高" },   // 竖长条
  L: { w: 4, h: 5, label: "大" },   // 大块
};

// ─── 每个 widget 允许的尺寸（积木只能装在对应槽位）────────────────────────
const WIDGET_PRESETS: Record<string, SizeKey[]> = {
  "stat-groups":    ["S"],
  "stat-tags":      ["S"],
  "stat-entities":  ["S"],
  "stat-pending":   ["S"],
  "entity-dist":    ["M", "L"],
  "top-groups":     ["T", "L"],
  "service-health": ["W", "L"],
};

// ─── 默认布局：积木拼图（位置错落、尺寸混搭）────────────────────────────
// 禁止自由拉伸 → 不需要 minW/minH，只能在 WIDGET_PRESETS 内切换
const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "stat-groups",    x:  0, y: 1, ...SIZE_PRESETS.S },
  { i: "stat-tags",      x:  2, y: 0, ...SIZE_PRESETS.S },
  { i: "stat-entities",  x:  2, y: 3, ...SIZE_PRESETS.S },
  { i: "entity-dist",    x:  4, y: 1, ...SIZE_PRESETS.L },
  { i: "top-groups",     x:  8, y: 0, ...SIZE_PRESETS.T },
  { i: "stat-pending",   x: 11, y: 1, ...SIZE_PRESETS.S },
  { i: "service-health", x:  8, y: 5, ...SIZE_PRESETS.W },
];

// ─── 工具：获取 widget 当前所处的 preset key ──────────────────────────────
function currentPreset(item: LayoutItem): SizeKey | null {
  const allowed = WIDGET_PRESETS[item.i] ?? [];
  return allowed.find(k => SIZE_PRESETS[k].w === item.w && SIZE_PRESETS[k].h === item.h) ?? null;
}

// ─── Stat 卡片配置（颜色 + 图标）────────────────────────────────────────────
const STAT_CONFIG = {
  "stat-groups":   { color: "#6366f1", bg: "rgba(99,102,241,0.12)",   ring: "rgba(99,102,241,0.25)"  },
  "stat-tags":     { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)",  ring: "rgba(139,92,246,0.25)"  },
  "stat-entities": { color: "#06b6d4", bg: "rgba(6,182,212,0.12)",   ring: "rgba(6,182,212,0.25)"   },
  "stat-pending":  { color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  ring: "rgba(245,158,11,0.25)"  },
} as const;

const WIDGET_LABELS: Record<string, string> = {
  "stat-groups":    "标签分组",
  "stat-tags":      "标签总数",
  "stat-entities":  "已注册实体",
  "stat-pending":   "待审核",
  "entity-dist":    "实体类型分布",
  "top-groups":     "分组标签量",
  "service-health": "服务状态",
};

// ─── 工具函数 ────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n.toLocaleString("zh-CN");
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── 布局持久化格式（含版本号）──────────────────────────────────────────────
type PersistedLayout = PersistedDashboardLayout & { items: LayoutItem[] }

// ═══════════════════════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const [data,        setData]        = useState<DashData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [updatedAt,   setUpdatedAt]   = useState<Date | null>(null);
  const [layout,      setLayout]      = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const [editMode,    setEditMode]    = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── 从后端加载布局（含版本校验）──────────────────────────────────────────
  useEffect(() => {
    getDashboardLayout()
      .then(raw => {
        // 新格式：{ version, items }；旧格式为裸数组
        const saved = raw as PersistedLayout | LayoutItem[] | null;
        if (saved && !Array.isArray(saved) && saved.version === LAYOUT_VERSION && Array.isArray(saved.items) && saved.items.length > 0) {
          setLayout(saved.items as LayoutItem[]);
        }
        // 旧格式或版本不匹配 → 使用 DEFAULT_LAYOUT（已在 state 初始值中）
      })
      .catch(() => { /* 静默降级 */ })
      .finally(() => setLayoutReady(true));
  }, []);

  // ── 布局变化 → 防抖保存 ──────────────────────────────────────────────────
  const handleLayoutChange = useCallback((next: readonly LayoutItem[]) => {
    const items = [...next] as LayoutItem[];
    setLayout(items);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload: PersistedLayout = { version: LAYOUT_VERSION, items };
      saveDashboardLayout(payload).catch(console.error);
    }, 800);
  }, []);

  // ── 切换 widget 尺寸到指定 preset ────────────────────────────────────────
  const switchSize = useCallback((id: string, size: SizeKey) => {
    setLayout(prev => {
      const next = prev.map(it =>
        it.i === id
          ? { ...it, w: SIZE_PRESETS[size].w, h: SIZE_PRESETS[size].h }
          : it,
      );
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const payload: PersistedLayout = { version: LAYOUT_VERSION, items: next };
        saveDashboardLayout(payload).catch(console.error);
      }, 400);
      return next;
    });
  }, []);

  // ── 加载仪表盘数据 ────────────────────────────────────────────────────────
  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [groupsRes, typesRes, auditRes, healthRes] = await Promise.allSettled([
      getTagGroups({ pageSize: 100 }),
      getEntityTypes(),
      getAuditItems({ status: "pending", pageSize: 1 }),
      getHealth(),
    ]);
    const groups    = groupsRes.status === "fulfilled" ? groupsRes.value : null;
    const types     = typesRes.status  === "fulfilled" ? typesRes.value  : [];
    const auditPage = auditRes.status  === "fulfilled" ? auditRes.value  : null;
    const health    = healthRes.status === "fulfilled" ? healthRes.value : null;

    const totalTags     = groups?.items.reduce((s, g) => s + (g._count?.tags ?? 0), 0) ?? 0;
    const totalEntities = types.reduce((s, t) => s + t.count, 0);
    const topGroups     = (groups?.items ?? [])
      .map(g => ({ id: g.id, name: g.name, tags: g._count?.tags ?? 0 }))
      .sort((a, b) => b.tags - a.tags)
      .slice(0, 10);

    setData({
      stats:       { groups: groups?.total ?? 0, tags: totalTags, entities: totalEntities, pending: auditPage?.total ?? 0 },
      entityTypes: [...types].sort((a, b) => b.count - a.count),
      topGroups,
      health,
    });
    setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── 渲染 Widget 内容 ──────────────────────────────────────────────────────
  const renderWidget = (id: string) => {
    if (!data) return <WidgetSkeleton />;
    const { stats, entityTypes, topGroups, health } = data;
    const maxCount = Math.max(...entityTypes.map(t => t.count), 1);

    switch (id) {
      case "stat-groups":
        return <StatWidget id="stat-groups" icon={<Layers size={18} strokeWidth={1.5} />}
          label="标签分组" value={fmt(stats.groups)} sub="个维度" href="/groups" />;
      case "stat-tags":
        return <StatWidget id="stat-tags" icon={<Tag size={18} strokeWidth={1.5} />}
          label="标签总数" value={fmt(stats.tags)} sub="个标签值" href="/groups" />;
      case "stat-entities":
        return <StatWidget id="stat-entities" icon={<Box size={18} strokeWidth={1.5} />}
          label="已注册实体" value={fmt(stats.entities)} sub={`${entityTypes.length} 种类型`} href="/entities" />;
      case "stat-pending":
        return <StatWidget id="stat-pending" icon={<ClipboardCheck size={18} strokeWidth={1.5} />}
          label="待审核" value={fmt(stats.pending)} sub="条 AI 标签" href="/audit"
          alert={stats.pending > 0} />;
      case "entity-dist":
        return <EntityDistWidget entityTypes={entityTypes} maxCount={maxCount} />;
      case "top-groups":
        return <TopGroupsWidget groups={topGroups} />;
      case "service-health":
        return <HealthWidget health={health} />;
      default: return null;
    }
  };

  // ── 加载中骨架 ────────────────────────────────────────────────────────────
  if (loading || !layoutReady) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ minHeight: "70vh" }}>
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white/40 animate-spin" />
          </div>
          <p className="text-[12px] text-white/30 tracking-wider">加载中…</p>
        </div>
      </div>
    );
  }

  // ── 主渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-8 py-5 sticky top-0 z-20 shrink-0"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-4">
          <div>
            <h1
              className="font-extrabold text-white leading-none"
              style={{ fontSize: 26, letterSpacing: "-0.04em" }}
            >
              仪表盘
            </h1>
            <p className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
              Taxon 标签服务全局概览
            </p>
          </div>
          {/* 实时状态指示器 */}
          {data?.health && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
              style={{
                background: data.health.status === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${data.health.status === "ok" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: data.health.status === "ok" ? "#4ade80" : "#f87171",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: data.health.status === "ok" ? "#4ade80" : "#f87171",
                  boxShadow: data.health.status === "ok" ? "0 0 6px #4ade80" : "0 0 6px #f87171",
                }}
              />
              {data.health.status === "ok" ? "服务正常" : "服务异常"}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-[11px] mr-1 tabular-nums" style={{ color: "rgba(255,255,255,0.25)" }}>
              {fmtTime(updatedAt.toISOString())} 更新
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-all disabled:opacity-30"
            style={{
              color: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.9)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
            }}
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            刷新
          </button>
          <button
            onClick={() => setEditMode(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-all"
            style={editMode ? {
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)",
            } : {
              color: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {editMode ? <Check size={12} /> : <LayoutGrid size={12} />}
            {editMode ? "完成编辑" : "编辑布局"}
          </button>
        </div>
      </div>

      {/* ── 待审核横幅 ──────────────────────────────────────────────────────── */}
      {data && data.stats.pending > 0 && (
        <Link
          href="/audit"
          className="flex items-center justify-between px-8 py-2.5 shrink-0 group transition-colors"
          style={{
            borderBottom: "1px solid rgba(245,158,11,0.2)",
            background: "rgba(245,158,11,0.04)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.08)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.04)"; }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={12} style={{ color: "#f59e0b" }} />
            <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.6)" }}>
              有 <span className="font-bold" style={{ color: "#f59e0b" }}>{data.stats.pending}</span> 条 AI 标签待人工审核
            </p>
          </div>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            前往审核 <ArrowRight size={10} />
          </span>
        </Link>
      )}

      {/* ── Bento 画布 ──────────────────────────────────────────────────────── */}
      {/* 横向 dashboard：视口高度内铺开，横向滚动；点状网格仅编辑态显示 */}
      <div
        className={cn("flex-1 overflow-x-auto overflow-y-hidden relative", editMode && "bento-edit")}
        style={editMode ? {
          background: "#070707",
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        } : {
          background: "#000",
        }}
      >
        <ReactGridLayout
          layout={layout}
          cols={COLS}
          rowHeight={ROW_H}
          width={CANVAS_W}
          margin={MARGIN}
          containerPadding={PAD}
          isDraggable={editMode}
          isResizable={false}
          onLayoutChange={handleLayoutChange}
          compactType={null}
          draggableHandle=".drag-handle"
          useCSSTransforms
        >
          {layout.map(item => (
            <div
              key={item.i}
              className={cn(
                "flex flex-col overflow-hidden transition-all duration-200",
                editMode && "cursor-move",
              )}
              style={{
                borderRadius: 22,
                background: "#161616",
                border: editMode
                  ? "1px solid rgba(255,255,255,0.16)"
                  : "1px solid rgba(255,255,255,0.05)",
                boxShadow: editMode
                  ? "0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 60px rgba(0,0,0,0.7)"
                  : "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 40px rgba(0,0,0,0.55)",
              }}
            >
              {/* 编辑模式：拖拽把手 + 尺寸切换按钮 */}
              {editMode && (
                <div
                  className="drag-handle flex items-center justify-between gap-2 px-4 py-2.5 shrink-0 select-none cursor-grab active:cursor-grabbing"
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GripHorizontal size={12} style={{ color: "rgba(255,255,255,0.25)" }} />
                    <span
                      className="text-[10px] uppercase tracking-widest truncate"
                      style={{ color: "rgba(255,255,255,0.3)" }}
                    >
                      {WIDGET_LABELS[item.i] ?? item.i}
                    </span>
                  </div>
                  {/* 尺寸切换（仅当 widget 有多个 preset 时显示）*/}
                  {(WIDGET_PRESETS[item.i]?.length ?? 0) > 1 && (
                    <div
                      className="flex items-center gap-0.5 shrink-0 cursor-default"
                      // 阻止 mousedown 冒泡到拖拽把手，避免点按钮时触发拖拽
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                    >
                      {WIDGET_PRESETS[item.i].map(size => {
                        const active = currentPreset(item) === size;
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => switchSize(item.i, size)}
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md transition-all"
                            style={active ? {
                              color: "#fff",
                              background: "rgba(255,255,255,0.16)",
                              border: "1px solid rgba(255,255,255,0.22)",
                            } : {
                              color: "rgba(255,255,255,0.4)",
                              background: "transparent",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                            title={`切换为${SIZE_PRESETS[size].label}尺寸 (${SIZE_PRESETS[size].w}×${SIZE_PRESETS[size].h})`}
                          >
                            {SIZE_PRESETS[size].label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {/* Widget 内容区 */}
              <div className="flex-1 min-h-0">
                {renderWidget(item.i)}
              </div>
            </div>
          ))}
        </ReactGridLayout>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Widget 组件
// ═══════════════════════════════════════════════════════════════════════════════

// ── Stat 数字卡 ──────────────────────────────────────────────────────────────
function StatWidget({
  id, icon, label, value, sub, href, alert = false,
}: {
  id: keyof typeof STAT_CONFIG;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  href: string;
  alert?: boolean;
}) {
  const cfg = STAT_CONFIG[id];
  const accentColor = alert ? "#f59e0b" : cfg.color;
  const accentBg    = alert ? "rgba(245,158,11,0.12)" : cfg.bg;
  const accentRing  = alert ? "rgba(245,158,11,0.25)" : cfg.ring;

  return (
    <Link
      href={href}
      className="flex flex-col h-full p-5 group"
      style={{ textDecoration: "none" }}
    >
      {/* 顶部色条 */}
      <div className="shrink-0 h-[3px] rounded-full mb-5 transition-all duration-300"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />

      {/* 图标 + 标签 */}
      <div className="flex items-center justify-between mb-auto">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          {label}
        </span>
        <span
          className="p-2 rounded-xl transition-all duration-200"
          style={{
            color: accentColor,
            background: accentBg,
            border: `1px solid ${accentRing}`,
          }}
        >
          {icon}
        </span>
      </div>

      {/* 大数字 */}
      <div className="mt-4">
        <p
          className="font-extrabold leading-none tabular-nums text-white"
          style={{
            fontSize: 38,
            letterSpacing: "-0.05em",
          }}
        >
          {value}
        </p>
        {sub && (
          <p className="text-[11px] mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>
            {sub}
          </p>
        )}
      </div>

      {/* 底部跳转提示（hover 时出现）*/}
      <div
        className="flex items-center gap-1 mt-3 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ color: accentColor }}
      >
        查看详情 <ChevronRight size={10} />
      </div>
    </Link>
  );
}

// ── 实体类型分布 ──────────────────────────────────────────────────────────────
function EntityDistWidget({ entityTypes, maxCount }: {
  entityTypes: EntityTypeStat[];
  maxCount: number;
}) {
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Box size={13} strokeWidth={1.5} />} title="实体类型分布" href="/entities" />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
        {entityTypes.length === 0 ? (
          <Empty text="暂无实体数据" />
        ) : entityTypes.map((t, i) => {
          const pct = Math.round((t.count / maxCount) * 100);
          return (
            <Link
              key={t.entityType}
              href={`/entities/${encodeURIComponent(t.entityType)}`}
              className="flex items-center gap-3 group animate-slide-up"
              style={{ animationDelay: `${i * 30}ms`, textDecoration: "none" }}
            >
              <span
                className="w-[90px] shrink-0 font-mono text-[11px] truncate transition-colors duration-150 group-hover:text-white"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                {t.entityType}
              </span>
              <div className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, rgba(99,102,241,0.7), rgba(139,92,246,0.5))",
                  }}
                />
              </div>
              <span
                className="w-9 text-right text-[11px] tabular-nums shrink-0 font-mono"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                {t.count.toLocaleString("zh-CN")}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── 分组标签量 ────────────────────────────────────────────────────────────────
function TopGroupsWidget({ groups }: { groups: GroupStat[] }) {
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<TrendingUp size={13} strokeWidth={1.5} />} title="分组标签量" href="/groups" />
      <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        {groups.length === 0 ? (
          <Empty text="暂无分组数据" />
        ) : groups.map((g, i) => (
          <Link
            key={g.id}
            href={`/groups/${g.id}`}
            className="flex items-center justify-between px-5 py-3 group transition-colors duration-150"
            style={{ textDecoration: "none" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.025)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="text-[10px] tabular-nums w-4 text-right shrink-0 font-mono"
                style={{ color: "rgba(255,255,255,0.18)" }}
              >
                {i + 1}
              </span>
              <span
                className="text-[12px] truncate transition-colors duration-150 group-hover:text-white"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                {g.name}
              </span>
            </div>
            <span
              className="text-[17px] font-extrabold ml-3 shrink-0 tabular-nums font-mono"
              style={{ letterSpacing: "-0.03em", color: "rgba(255,255,255,0.9)" }}
            >
              {g.tags}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── 服务状态 ──────────────────────────────────────────────────────────────────
function HealthWidget({ health }: { health: HealthInfo | null }) {
  const cells = [
    {
      label: "服务",
      value: health
        ? <StatusDot ok={health.status === "ok"} text={health.status === "ok" ? "正常" : "异常"} />
        : <StatusDot ok={false} text="无法连接" />,
    },
    {
      label: "数据库",
      value: health
        ? <StatusDot ok={health.db === "ok"} text={health.db === "ok" ? "正常" : "异常"} />
        : <StatusDot ok={false} text="未知" />,
    },
    {
      label: "服务版本",
      value: (
        <span className="font-mono text-[13px] font-semibold text-white">
          {health?.version ? `v${health.version}` : "—"}
        </span>
      ),
    },
    {
      label: "Node.js",
      value: (
        <span className="font-mono text-[13px]" style={{ color: "rgba(255,255,255,0.7)" }}>
          {health?.nodeVersion ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<CheckCircle2 size={13} strokeWidth={1.5} />} title="服务状态" />
      <div className="flex-1 flex flex-col min-h-0">
        {cells.map((cell, idx) => (
          <div
            key={cell.label}
            className="flex-1 flex items-center justify-between gap-3 px-5 py-3 min-h-0"
            style={{
              borderBottom: idx < cells.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
              {cell.label}
            </p>
            <div className="text-right">{cell.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 共用小组件
// ═══════════════════════════════════════════════════════════════════════════════

function WidgetHeader({ icon, title, href }: {
  icon: React.ReactNode;
  title: string;
  href?: string;
}) {
  return (
    <div
      className="flex items-center justify-between px-5 py-3.5 shrink-0"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: "rgba(255,255,255,0.3)" }}>{icon}</span>
        <p className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>
          {title}
        </p>
      </div>
      {href && (
        <Link
          href={href}
          className="flex items-center gap-0.5 text-[10px] transition-colors duration-150"
          style={{ color: "rgba(255,255,255,0.25)", textDecoration: "none" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.6)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.25)"; }}
        >
          全部 <ChevronRight size={10} />
        </Link>
      )}
    </div>
  );
}

function StatusDot({ ok, text }: { ok: boolean; text: string }) {
  const color = ok ? "#4ade80" : "#f87171";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color }}>
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      {text}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-12 flex items-center justify-center text-[12px]" style={{ color: "rgba(255,255,255,0.2)" }}>
      {text}
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div
        className="w-5 h-5 rounded-full border-2 border-transparent animate-spin"
        style={{ borderTopColor: "rgba(255,255,255,0.2)" }}
      />
    </div>
  );
}
