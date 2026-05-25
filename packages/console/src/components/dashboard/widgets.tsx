/**
 * Dashboard widgets 集合
 *
 * 所有可视化组件统一管理，便于维护配色和共用工具。
 * 配色遵循 Brand Gradient（蓝紫渐变）+ Cyan/Amber 辅色 + 暗色 elevation 层级。
 */

"use client";

import Link from "next/link";
import {
  Layers, Tag, Box, ClipboardCheck, TrendingUp, TrendingDown, Activity,
  CheckCircle2, AlertCircle, ChevronRight, Sparkles,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type {
  DashboardData, EntityTypeStat,
} from "./use-dashboard-data";
import type { ActivityEvent, HealthInfo, TrendPoint } from "@/lib/api";

// ═══════════════════════════════════════════════════════════════
// 设计 tokens
// ═══════════════════════════════════════════════════════════════
/**
 * 设计 token — 全部引用 CSS 变量，自动适配 dark/light 主题。
 * CSS 变量在 globals.css :root / [data-theme="light"] 中定义。
 */
export const COLORS = {
  brand1:  "var(--color-brand-1)",
  brand2:  "var(--color-brand-2)",
  cyan:    "var(--color-cyan)",
  amber:   "var(--color-amber)",
  ok:      "var(--color-ok)",
  bad:     "var(--color-bad)",
  // 文本灰阶
  ink:     "var(--color-ink)",
  ink2:    "var(--color-ink-dim)",
  ink3:    "var(--color-ink-sub)",
  ink4:    "var(--color-ink-faint)",
  // 表面 elevation
  bg1:     "var(--color-surface)",
  bg2:     "var(--color-row-head)",
  bg3:     "var(--color-overlay)",
  edge1:   "var(--color-edge)",
  edge2:   "var(--color-edge-mid)",
};

const PIE_COLORS = [
  "#6366f1", "#a855f7", "#06b6d4", "#f59e0b", "#22c55e",
  "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#8b5cf6",
];

// ═══════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════
export function fmt(n: number) {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}w`;
  return n.toLocaleString("zh-CN");
}
function pctSign(p: number) { return p > 0 ? `+${p}%` : `${p}%`; }
function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)    return `${sec}秒前`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}时前`;
  return `${Math.floor(sec / 86400)}天前`;
}

// ═══════════════════════════════════════════════════════════════
// 通用：标题栏 / 空态
// ═══════════════════════════════════════════════════════════════
export function WidgetHeader({ icon, title, href, sub }: {
  icon?: React.ReactNode; title: string; href?: string; sub?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3 shrink-0"
      style={{ borderBottom: `1px solid ${COLORS.edge1}` }}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span style={{ color: COLORS.ink3 }}>{icon}</span>}
        <p className="text-sm font-semibold truncate" style={{ color: COLORS.ink2 }}>{title}</p>
        {sub && <span className="text-2xs" style={{ color: COLORS.ink4 }}>· {sub}</span>}
      </div>
      {href && (
        <Link href={href} className="flex items-center gap-0.5 text-2xs hover:opacity-100 transition-opacity"
          style={{ color: COLORS.ink3, textDecoration: "none" }}>
          全部 <ChevronRight size={10} />
        </Link>
      )}
    </div>
  );
}

export function WidgetEmpty({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-sm" style={{ color: COLORS.ink4 }}>
      {text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 1) KPI Hero — 主指标 + 7 天 Area + 同比
// ═══════════════════════════════════════════════════════════════
export function KpiHero({ data }: { data: DashboardData }) {
  const { stats, trend, today } = data;
  const series = trend?.series ?? [];
  const todayTags = today?.tags;

  return (
    <div className="flex flex-col h-full p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: COLORS.brand2 }} />
          <span className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: COLORS.ink3 }}>
            核心指标 · 标签总数
          </span>
        </div>
        {todayTags && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
            style={{
              background: todayTags.comparePct >= 0 ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
              border: `1px solid ${todayTags.comparePct >= 0 ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
            }}>
            {todayTags.comparePct >= 0
              ? <TrendingUp size={10} style={{ color: COLORS.ok }} />
              : <TrendingDown size={10} style={{ color: COLORS.bad }} />}
            <span className="text-2xs font-bold tabular-nums" style={{
              color: todayTags.comparePct >= 0 ? COLORS.ok : COLORS.bad,
            }}>
              {pctSign(todayTags.comparePct)}
            </span>
          </div>
        )}
      </div>

      {/* 大数字 */}
      <div className="mt-6">
        <p className="font-extrabold leading-none tabular-nums"
          style={{ fontSize: 88, letterSpacing: "-0.05em", color: COLORS.ink,
                   background: `linear-gradient(135deg, ${COLORS.ink} 0%, ${COLORS.brand2} 120%)`,
                   WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                   backgroundClip: "text" }}>
          {fmt(stats.tags)}
        </p>
        <div className="flex items-baseline gap-3 mt-2">
          <span className="text-sm" style={{ color: COLORS.ink3 }}>标签实例总数</span>
          {todayTags && (
            <span className="text-xs tabular-nums" style={{ color: COLORS.ink3 }}>
              今日 <span className="font-semibold" style={{ color: COLORS.ink }}>+{todayTags.today}</span>
            </span>
          )}
        </div>
      </div>

      {/* 7 天 Area 图 */}
      <div className="flex-1 min-h-0 mt-4">
        {series.length === 0 ? <WidgetEmpty text="加载趋势数据…" /> : (
          <ResponsiveContainer width="100%" height="100%" minHeight={80}>
            <AreaChart data={series} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="kpi-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={COLORS.brand2} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.brand2} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: COLORS.edge2 }} />
              <Area type="monotone" dataKey="tags" stroke={COLORS.brand2} strokeWidth={2}
                fill="url(#kpi-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="text-2xs mt-1 tabular-nums" style={{ color: COLORS.ink4 }}>
        过去 7 天新增标签趋势
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2) Entity Pie — 实体类型环形分布
// ═══════════════════════════════════════════════════════════════
export function EntityPie({ entityTypes }: { entityTypes: EntityTypeStat[] }) {
  const total = entityTypes.reduce((s, t) => s + t.count, 0);
  const display = entityTypes.slice(0, 8);
  // 折叠剩余项为 "其他"
  if (entityTypes.length > 8) {
    const rest = entityTypes.slice(8).reduce((s, t) => s + t.count, 0);
    if (rest > 0) display.push({ entityType: "其他", count: rest });
  }

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Box size={13} strokeWidth={1.5} />} title="实体类型分布" href="/entities" />
      {display.length === 0 ? <WidgetEmpty text="暂无实体数据" /> : (
        <div className="flex-1 grid grid-cols-[1fr,1fr] gap-3 px-5 py-4 min-h-0">
          {/* 环形图 + 中心总数 */}
          <div className="relative flex items-center justify-center min-h-0">
            <ResponsiveContainer width="100%" height="100%" minHeight={120}>
              <PieChart>
                <Pie data={display} dataKey="count" nameKey="entityType"
                  innerRadius="60%" outerRadius="92%" strokeWidth={0} startAngle={90} endAngle={450}
                  paddingAngle={1.5}>
                  {display.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-2xs uppercase tracking-wider" style={{ color: COLORS.ink4 }}>总计</p>
              <p className="font-extrabold tabular-nums leading-none mt-1"
                style={{ fontSize: 30, color: COLORS.ink, letterSpacing: "-0.04em" }}>{fmt(total)}</p>
              <p className="text-2xs mt-1" style={{ color: COLORS.ink3 }}>
                {entityTypes.length} 种类型
              </p>
            </div>
          </div>
          {/* 图例列表 */}
          <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto pr-1">
            {display.map((t, i) => {
              const pct = total ? Math.round((t.count / total) * 100) : 0;
              return (
                <div key={t.entityType} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="flex-1 truncate font-mono" style={{ color: COLORS.ink2 }}>{t.entityType}</span>
                  <span className="tabular-nums shrink-0" style={{ color: COLORS.ink3 }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 3) Trend Chart — 三线对比图
// ═══════════════════════════════════════════════════════════════
function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; color: string; name: string; payload: TrendPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="text-xs px-3 py-2 rounded-lg"
      style={{ background: COLORS.bg3, border: `1px solid ${COLORS.edge2}`, boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
      <p className="font-mono mb-1" style={{ color: COLORS.ink3 }}>{p.date.slice(5)}</p>
      {payload.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-sm" style={{ background: it.color }} />
          <span style={{ color: COLORS.ink2 }}>{it.name}</span>
          <span className="font-mono tabular-nums" style={{ color: COLORS.ink }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data }: { data: DashboardData }) {
  const series = data.trend?.series ?? [];
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Activity size={13} strokeWidth={1.5} />} title="趋势对比" sub="过去 7 天" />
      {series.length === 0 ? <WidgetEmpty text="加载趋势数据…" /> : (
        <div className="flex-1 min-h-0 p-3">
          <ResponsiveContainer width="100%" height="100%" minHeight={80}>
            <LineChart data={series} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
              <XAxis dataKey="date" tickFormatter={d => d.slice(5)} stroke={COLORS.ink4}
                tick={{ fontSize: 10, fill: COLORS.ink3 }} axisLine={false} tickLine={false} />
              <YAxis stroke={COLORS.ink4} tick={{ fontSize: 10, fill: COLORS.ink3 }}
                axisLine={false} tickLine={false} width={30} />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: COLORS.edge2, strokeDasharray: 4 }} />
              <Line type="monotone" dataKey="tags"     name="标签" stroke={COLORS.brand2} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="entities" name="实体" stroke={COLORS.cyan}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="reviews"  name="审核" stroke={COLORS.amber}  strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {/* 图例 */}
      <div className="flex items-center justify-center gap-4 px-4 pb-3 shrink-0">
        {[
          { c: COLORS.brand2, l: "新增标签" },
          { c: COLORS.cyan,   l: "新增实体" },
          { c: COLORS.amber,  l: "审核操作" },
        ].map(x => (
          <div key={x.l} className="flex items-center gap-1.5 text-2xs" style={{ color: COLORS.ink3 }}>
            <span className="w-3 h-[2px] rounded-full" style={{ background: x.c }} />
            {x.l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 4) Stat Mini — 含 sparkline 的统计小卡
// ═══════════════════════════════════════════════════════════════
const STAT_THEME = {
  "stat-groups":   { color: "#6366f1", icon: Layers,         label: "标签分组",   href: "/groups",   metric: "groups",   trendKey: null            as "tags" | "entities" | "reviews" | null },
  "stat-tags":     { color: "#a855f7", icon: Tag,            label: "标签总数",   href: "/groups",   metric: "tags",     trendKey: "tags"          as const },
  "stat-entities": { color: "#06b6d4", icon: Box,            label: "已注册实体", href: "/entities", metric: "entities", trendKey: "entities"      as const },
  "stat-pending":  { color: "#f59e0b", icon: ClipboardCheck, label: "待审核",     href: "/audit",    metric: "pending",  trendKey: null            as "tags" | "entities" | "reviews" | null },
} as const;

export function StatMini({ id, data }: { id: keyof typeof STAT_THEME; data: DashboardData }) {
  const theme = STAT_THEME[id];
  const Icon  = theme.icon;
  const value = data.stats[theme.metric as keyof typeof data.stats];
  const today = theme.metric === "tags"     ? data.today?.tags
              : theme.metric === "entities" ? data.today?.entities
              : theme.metric === "pending"  ? data.today?.audits
              : null;
  const spark = theme.trendKey ? (data.trend?.series ?? []).map(s => ({ v: s[theme.trendKey!] })) : null;
  const isAlert = id === "stat-pending" && value > 0;

  return (
    <Link href={theme.href} className="flex flex-col h-full p-4 group relative overflow-hidden"
      style={{ textDecoration: "none" }}>
      {/* 角落淡色装饰 */}
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none transition-opacity duration-300 opacity-30 group-hover:opacity-50"
        style={{ background: `radial-gradient(circle, ${theme.color}40, transparent 70%)` }} />

      {/* 顶部：图标 + 标签 + 同比 */}
      <div className="flex items-start justify-between gap-2 shrink-0 relative z-10">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg"
            style={{ background: `${theme.color}1F`, color: theme.color, border: `1px solid ${theme.color}33` }}>
            <Icon size={13} strokeWidth={1.8} />
          </span>
          <span className="text-2xs font-semibold uppercase tracking-[0.1em]" style={{ color: COLORS.ink3 }}>
            {theme.label}
          </span>
        </div>
        {today && today.comparePct !== 0 && (
          <span className="text-2xs font-bold tabular-nums flex items-center gap-0.5" style={{
            color: today.comparePct >= 0 ? COLORS.ok : COLORS.bad,
          }}>
            {today.comparePct >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {pctSign(today.comparePct)}
          </span>
        )}
      </div>

      {/* 大数字 */}
      <div className="flex-1 flex flex-col justify-center relative z-10">
        <p className="font-extrabold tabular-nums leading-none"
          style={{ fontSize: 44, letterSpacing: "-0.04em",
            color: isAlert ? theme.color : COLORS.ink }}>
          {fmt(value)}
        </p>
        {today && (
          <p className="text-2xs mt-1.5 tabular-nums" style={{ color: COLORS.ink3 }}>
            今日 +{today.today}
          </p>
        )}
      </div>

      {/* Sparkline */}
      {spark && spark.length > 0 && (
        <div className="h-7 -mx-1 relative z-10">
          <ResponsiveContainer width="100%" height="100%" minHeight={28}>
            <AreaChart data={spark} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={theme.color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={theme.color} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={theme.color} strokeWidth={1.5}
                fill={`url(#spark-${id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Link>
  );
}

// ═══════════════════════════════════════════════════════════════
// 5) Activity Feed — 最近活动流（自滚动）
// ═══════════════════════════════════════════════════════════════
const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  manual: { label: "手动",   color: "#06b6d4" },
  ai:     { label: "AI",     color: "#a855f7" },
  system: { label: "系统",   color: "#22c55e" },
  import: { label: "导入",   color: "#f59e0b" },
};

export function ActivityFeed({ activity }: { activity: ActivityEvent[] }) {
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Activity size={13} strokeWidth={1.5} />} title="最近活动" sub={`${activity.length} 条`} />
      {activity.length === 0 ? <WidgetEmpty text="暂无活动记录" /> : (
        <ul className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {activity.map((ev, i) => (
            <li key={`${ev.kind}-${ev.time}-${i}`}
              className="px-3 py-2 rounded-md text-xs transition-colors hover:bg-white/[0.025] animate-slide-up"
              style={{ animationDelay: `${i * 25}ms` }}>
              <div className="flex items-center gap-2">
                {ev.kind === "tag-added" ? (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0"
                    style={{
                      background: `${SOURCE_LABEL[ev.source]?.color ?? "#fff"}1F`,
                      color: SOURCE_LABEL[ev.source]?.color ?? "#fff",
                    }}>
                    {SOURCE_LABEL[ev.source]?.label ?? ev.source}
                  </span>
                ) : (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono shrink-0"
                    style={{
                      background: ev.toStatus === "active" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      color: ev.toStatus === "active" ? COLORS.ok : COLORS.bad,
                    }}>
                    {ev.toStatus === "active" ? "通过" : "拒绝"}
                  </span>
                )}
                <span className="font-mono text-2xs truncate" style={{ color: COLORS.ink }}>{ev.tagName}</span>
                <span className="text-2xs ml-auto shrink-0 tabular-nums" style={{ color: COLORS.ink4 }}>
                  {timeAgo(ev.time)}
                </span>
              </div>
              <p className="text-2xs mt-0.5 truncate font-mono" style={{ color: COLORS.ink3 }}>
                {ev.entityType}/{ev.entityId.slice(0, 8)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 6) Health Bar — 服务健康（REC 4×2 横长条）
// ═══════════════════════════════════════════════════════════════
export function HealthBar({ health }: { health: HealthInfo | null }) {
  const cells: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "服务",
      value: <Dot ok={health?.status === "ok"} text={health?.status === "ok" ? "在线" : "异常"} />,
    },
    {
      label: "数据库",
      value: <Dot ok={health?.db === "ok"} text={health?.db === "ok" ? "正常" : "异常"} />,
    },
    {
      label: "服务版本",
      value: <span className="font-mono text-base font-semibold" style={{ color: COLORS.ink }}>
        {health?.version ? `v${health.version}` : "—"}
      </span>,
    },
    {
      label: "Node.js",
      value: <span className="font-mono text-sm" style={{ color: COLORS.ink2 }}>
        {health?.nodeVersion ?? "—"}
      </span>,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<CheckCircle2 size={13} strokeWidth={1.5} />} title="服务健康" />
      <div className="flex-1 grid grid-cols-4 min-h-0">
        {cells.map((c, i) => (
          <div key={c.label} className="flex flex-col justify-center gap-1 px-4"
            style={{ borderRight: i < cells.length - 1 ? `1px solid ${COLORS.edge1}` : "none" }}>
            <p className="text-2xs font-semibold uppercase tracking-[0.1em]" style={{ color: COLORS.ink4 }}>
              {c.label}
            </p>
            <div>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dot({ ok, text }: { ok: boolean; text: string }) {
  const color = ok ? COLORS.ok : COLORS.bad;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color }}>
      <span className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {text}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// PieChart tooltip
// ═══════════════════════════════════════════════════════════════
function PieTooltip({ active, payload, total }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { fill: string } }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const pct = total ? Math.round((p.value / total) * 100) : 0;
  return (
    <div className="text-xs px-3 py-2 rounded-lg"
      style={{ background: COLORS.bg3, border: `1px solid ${COLORS.edge2}` }}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-sm" style={{ background: p.payload.fill }} />
        <span className="font-mono" style={{ color: COLORS.ink }}>{p.name}</span>
      </div>
      <p className="font-mono tabular-nums mt-0.5" style={{ color: COLORS.ink2 }}>
        {p.value.toLocaleString()} · {pct}%
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主入口：根据 widget id 渲染
// ═══════════════════════════════════════════════════════════════
export function renderWidget(id: string, data: DashboardData) {
  switch (id) {
    case "kpi-hero":      return <KpiHero data={data} />;
    case "entity-pie":    return <EntityPie entityTypes={data.entityTypes} />;
    case "trend-chart":   return <TrendChart data={data} />;
    case "stat-groups":   return <StatMini id="stat-groups"   data={data} />;
    case "stat-tags":     return <StatMini id="stat-tags"     data={data} />;
    case "stat-entities": return <StatMini id="stat-entities" data={data} />;
    case "stat-pending":  return <StatMini id="stat-pending"  data={data} />;
    case "activity-feed": return <ActivityFeed activity={data.activity} />;
    case "health-bar":    return <HealthBar health={data.health} />;
    default: return <WidgetEmpty text={`未知组件 ${id}`} />;
  }
}

// 临时引用消除 unused 警告
void AlertCircle;
