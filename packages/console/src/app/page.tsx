"use client";

import { useState, useEffect, useCallback, useRef } from "react";
// react-grid-layout v2: ReactGridLayout 在 legacy 模块，Layout 是 readonly LayoutItem[]
import ReactGridLayout, { type LayoutItem } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import Link from "next/link";
import {
  Layers, Box, ClipboardCheck, Tag,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  ChevronRight, TrendingUp, LayoutGrid, Check,
  GripHorizontal,
} from "lucide-react";
import {
  getTagGroups, getEntityTypes, getAuditItems, getHealth,
  getDashboardLayout, saveDashboardLayout,
  type HealthInfo,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── 类型 ──────────────────────────────────────────────────────────
interface Stats {
  groups: number; tags: number; entities: number; pending: number;
}
interface EntityTypeStat { entityType: string; count: number }
interface GroupStat      { id: string; name: string; tags: number }
interface DashData {
  stats:       Stats;
  entityTypes: EntityTypeStat[];
  topGroups:   GroupStat[];
  health:      HealthInfo | null;
}

// ─── 常量 ──────────────────────────────────────────────────────────
const COLS       = 12;
const ROW_H      = 72;   // px per row unit
const MARGIN: [number, number] = [10, 10];
const PAD:    [number, number] = [28, 28];
const MIN_W      = 1240; // canvas 最小宽度，支持横向滚动

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "stat-groups",    x: 0, y: 0,  w: 3,  h: 4, minW: 2, minH: 3 },
  { i: "stat-tags",      x: 3, y: 0,  w: 3,  h: 4, minW: 2, minH: 3 },
  { i: "stat-entities",  x: 6, y: 0,  w: 3,  h: 4, minW: 2, minH: 3 },
  { i: "stat-pending",   x: 9, y: 0,  w: 3,  h: 4, minW: 2, minH: 3 },
  { i: "entity-dist",    x: 0, y: 4,  w: 7,  h: 9, minW: 4, minH: 5 },
  { i: "top-groups",     x: 7, y: 4,  w: 5,  h: 9, minW: 3, minH: 5 },
  { i: "service-health", x: 0, y: 13, w: 12, h: 3, minW: 6, minH: 2 },
];

const WIDGET_LABELS: Record<string, string> = {
  "stat-groups":    "标签分组",
  "stat-tags":      "标签总数",
  "stat-entities":  "已注册实体",
  "stat-pending":   "待审核",
  "entity-dist":    "实体类型分布",
  "top-groups":     "分组标签量",
  "service-health": "服务状态",
};

// ─── 工具函数 ───────────────────────────────────────────────────────
function fmt(n: number) {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n.toLocaleString("zh-CN");
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── 主页面 ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [data,      setData]      = useState<DashData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [layout,    setLayout]    = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const [editMode,  setEditMode]  = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  const containerRef  = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(MIN_W);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── 画布宽度自适应（横向可滚动）────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCanvasW(Math.max(entry.contentRect.width, MIN_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 从后端加载已保存布局 ─────────────────────────────────────────
  useEffect(() => {
    getDashboardLayout()
      .then(saved => { if (Array.isArray(saved) && saved.length > 0) setLayout(saved as LayoutItem[]); })
      .catch(() => {/* 静默降级到默认布局 */})
      .finally(() => setLayoutReady(true));
  }, []);

  // ── 布局变化 → 防抖保存 ──────────────────────────────────────────
  // Layout 是 readonly LayoutItem[]，需要展开为可变数组再存储
  const handleLayoutChange = useCallback((next: readonly LayoutItem[]) => {
    const mutable = [...next] as LayoutItem[];
    setLayout(mutable);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDashboardLayout(mutable).catch(console.error);
    }, 800);
  }, []);

  // ── 加载数据 ─────────────────────────────────────────────────────
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
      .slice(0, 8);

    setData({
      stats: { groups: groups?.total ?? 0, tags: totalTags, entities: totalEntities, pending: auditPage?.total ?? 0 },
      entityTypes: [...types].sort((a, b) => b.count - a.count),
      topGroups,
      health,
    });
    setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── 渲染 Widget 内容 ─────────────────────────────────────────────
  const renderWidget = (id: string) => {
    if (!data) return <WidgetLoading />;
    const { stats, entityTypes, topGroups, health } = data;
    const maxCount = Math.max(...entityTypes.map(t => t.count), 1);

    switch (id) {
      case "stat-groups":
        return <StatWidget icon={<Layers size={16} strokeWidth={1.5} />} label="标签分组" value={fmt(stats.groups)} sub="个维度" href="/groups" />;
      case "stat-tags":
        return <StatWidget icon={<Tag size={16} strokeWidth={1.5} />} label="标签总数" value={fmt(stats.tags)} sub="个标签值" href="/groups" />;
      case "stat-entities":
        return <StatWidget icon={<Box size={16} strokeWidth={1.5} />} label="已注册实体" value={fmt(stats.entities)} sub={`${entityTypes.length} 种类型`} href="/entities" />;
      case "stat-pending":
        return <StatWidget icon={<ClipboardCheck size={16} strokeWidth={1.5} />} label="待审核" value={fmt(stats.pending)} sub="条 AI 标签" href="/audit" alert={stats.pending > 0} />;
      case "entity-dist":
        return <EntityDistWidget entityTypes={entityTypes} maxCount={maxCount} />;
      case "top-groups":
        return <TopGroupsWidget groups={topGroups} />;
      case "service-health":
        return <HealthWidget health={health} />;
      default:
        return null;
    }
  };

  // ── 加载中 ───────────────────────────────────────────────────────
  if (loading || !layoutReady) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <div className="text-center space-y-3">
          <div className="w-7 h-7 rounded-full border-2 border-edge-mid border-t-ink-faint animate-spin mx-auto" />
          <p className="text-[12px] text-ink-faint">加载中…</p>
        </div>
      </div>
    );
  }

  // ── 主渲染 ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen">

      {/* ── 顶部 Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-edge bg-surface/90 backdrop-blur-sm sticky top-0 z-20 shrink-0">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink leading-none" style={{ letterSpacing: "-0.03em" }}>
            仪表盘
          </h1>
          <p className="text-[11px] text-ink-faint mt-1">Taxon 标签服务全局概览</p>
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-[11px] text-ink-faint tabular-nums mr-1 hidden sm:inline">
              {fmtTime(updatedAt.toISOString())} 更新
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-ink-faint hover:text-ink border border-edge hover:border-edge-strong hover:bg-surface-alt transition-all disabled:opacity-40"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            刷新
          </button>
          <button
            onClick={() => setEditMode(v => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] border transition-all",
              editMode
                ? "bg-white/[.07] border-white/15 text-ink"
                : "text-ink-faint border-edge hover:text-ink hover:border-edge-strong hover:bg-surface-alt",
            )}
          >
            {editMode ? <Check size={12} /> : <LayoutGrid size={12} />}
            {editMode ? "完成编辑" : "编辑布局"}
          </button>
        </div>
      </div>

      {/* ── 待审核横幅 ─────────────────────────────────────────────── */}
      {data && data.stats.pending > 0 && (
        <Link
          href="/audit"
          className="flex items-center justify-between px-8 py-2.5 border-b border-warn/20 bg-warn/[.04] hover:bg-warn/[.07] transition-colors group shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={12} className="text-warn shrink-0" />
            <p className="text-[12px] text-ink-sub group-hover:text-ink transition-colors">
              有 <span className="font-bold text-warn">{data.stats.pending}</span> 条 AI 标签待人工审核
            </p>
          </div>
          <span className="flex items-center gap-0.5 text-[11px] text-ink-faint group-hover:text-ink transition-colors">
            前往审核 <ChevronRight size={11} />
          </span>
        </Link>
      )}

      {/* ── Bento 画布 ─────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className={cn("flex-1 overflow-x-auto", editMode && "bento-edit")}
        style={{
          // 深色打点背景，模拟设计画布
          backgroundColor: "var(--bg)",
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <ReactGridLayout
          layout={layout}
          cols={COLS}
          rowHeight={ROW_H}
          width={canvasW}
          margin={MARGIN}
          containerPadding={PAD}
          isDraggable={editMode}
          isResizable={editMode}
          onLayoutChange={handleLayoutChange}
          compactType={null}         // 自由画布，不自动折叠
          draggableHandle=".drag-handle"
          resizeHandles={["se", "s", "e"]}
          useCSSTransforms
        >
          {layout.map(item => (
            <div
              key={item.i}
              className={cn(
                "flex flex-col rounded-2xl overflow-hidden",
                "border border-edge-mid bg-[#111] transition-shadow duration-200",
                editMode && "ring-1 ring-white/8 shadow-2xl shadow-black/50",
              )}
            >
              {/* 编辑模式拖拽把手 */}
              {editMode && (
                <div className="drag-handle flex items-center gap-2 px-4 py-2.5 border-b border-edge bg-[#0d0d0d] cursor-grab active:cursor-grabbing select-none shrink-0">
                  <GripHorizontal size={13} className="text-ink-faint/50" />
                  <span className="text-[10px] text-ink-faint/60 uppercase tracking-widest">
                    {WIDGET_LABELS[item.i] ?? item.i}
                  </span>
                </div>
              )}
              {/* Widget 内容 */}
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

// ═══════════════════════════════════════════════════════════════════
// Widget 组件
// ═══════════════════════════════════════════════════════════════════

// ── Stat 数字卡 ─────────────────────────────────────────────────────
function StatWidget({
  icon, label, value, sub, href, alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link href={href} className="flex flex-col h-full p-5 group transition-colors hover:bg-white/[.015]">
      <div className="flex items-center justify-between mb-auto">
        <span className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.1em]",
          alert ? "text-warn/70" : "text-ink-faint",
        )}>
          {label}
        </span>
        <span className={cn(
          "p-1.5 rounded-lg transition-colors",
          alert ? "text-warn bg-warn/10" : "text-ink-faint bg-white/[.04] group-hover:text-ink-dim",
        )}>
          {icon}
        </span>
      </div>
      <div className="mt-6">
        <p
          className={cn("font-extrabold leading-none tabular-nums", alert ? "text-warn" : "text-ink")}
          style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-0.04em" }}
        >
          {value}
        </p>
        {sub && <p className="text-[11px] text-ink-faint mt-2">{sub}</p>}
      </div>
    </Link>
  );
}

// ── 实体类型分布 ────────────────────────────────────────────────────
function EntityDistWidget({
  entityTypes, maxCount,
}: {
  entityTypes: EntityTypeStat[];
  maxCount: number;
}) {
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Box size={13} strokeWidth={1.5} />} title="实体类型分布" href="/entities" />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {entityTypes.length === 0 ? (
          <Empty text="暂无实体数据" />
        ) : (
          entityTypes.map((t, i) => {
            const pct = Math.round((t.count / maxCount) * 100);
            return (
              <Link
                key={t.entityType}
                href={`/entities/${encodeURIComponent(t.entityType)}`}
                className="group flex items-center gap-3 animate-slide-up"
                style={{ animationDelay: `${i * 25}ms` }}
              >
                <span className="w-[100px] shrink-0 font-mono text-[11px] text-ink-sub group-hover:text-ink transition-colors truncate">
                  {t.entityType}
                </span>
                <div className="flex-1 h-[5px] bg-edge rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/25 group-hover:bg-white/40 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-9 text-right text-[11px] text-ink-dim tabular-nums shrink-0">
                  {t.count.toLocaleString("zh-CN")}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── 分组标签量 ──────────────────────────────────────────────────────
function TopGroupsWidget({ groups }: { groups: GroupStat[] }) {
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<TrendingUp size={13} strokeWidth={1.5} />} title="分组标签量" href="/groups" />
      <div className="flex-1 overflow-y-auto divide-y divide-edge">
        {groups.length === 0 ? (
          <Empty text="暂无分组数据" />
        ) : (
          groups.map((g, i) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-white/[.02] transition-colors group animate-fade-in"
              style={{ animationDelay: `${i * 20}ms` }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[10px] text-ink-faint/40 tabular-nums w-4 text-right shrink-0">{i + 1}</span>
                <span className="text-[12px] text-ink-sub group-hover:text-ink transition-colors truncate">{g.name}</span>
              </div>
              <span className="text-[16px] font-extrabold text-ink tabular-nums ml-3 shrink-0" style={{ letterSpacing: "-0.03em" }}>
                {g.tags}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// ── 服务状态 ────────────────────────────────────────────────────────
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
      value: <span className="font-mono text-[12px] text-ink">{health?.version ? `v${health.version}` : "—"}</span>,
    },
    {
      label: "Node.js",
      value: <span className="font-mono text-[12px] text-ink">{health?.nodeVersion ?? "—"}</span>,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<CheckCircle2 size={13} strokeWidth={1.5} />} title="服务状态" />
      <div className="flex-1 grid grid-cols-4 divide-x divide-edge min-h-0">
        {cells.map(cell => (
          <div key={cell.label} className="px-5 flex flex-col justify-center gap-1.5">
            <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-[0.08em]">{cell.label}</p>
            <div>{cell.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 共用小组件
// ═══════════════════════════════════════════════════════════════════

function WidgetHeader({
  icon, title, href,
}: {
  icon: React.ReactNode;
  title: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-ink-faint">{icon}</span>
        <p className="text-[12px] font-semibold text-ink">{title}</p>
      </div>
      {href && (
        <Link href={href} className="flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-ink transition-colors">
          全部 <ChevronRight size={10} />
        </Link>
      )}
    </div>
  );
}

function StatusDot({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", ok ? "text-ok" : "text-bad")}>
      {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
      {text}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-10 flex items-center justify-center text-[12px] text-ink-faint">
      {text}
    </div>
  );
}

function WidgetLoading() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="w-5 h-5 rounded-full border-2 border-edge-mid border-t-ink-faint animate-spin" />
    </div>
  );
}
