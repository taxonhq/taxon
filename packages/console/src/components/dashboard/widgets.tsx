/**
 * Dashboard widgets 集合
 *
 * 所有可视化组件统一管理，便于维护配色和共用工具。
 * 配色遵循 Brand Gradient（蓝紫渐变）+ Cyan/Amber 辅色 + 暗色 elevation 层级。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Layers, Tag, Box, ClipboardCheck, TrendingUp, TrendingDown, Activity,
  CheckCircle2, AlertCircle, ChevronRight, Sparkles,
} from "lucide-react";
import {
  AreaChart, Area, LineChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type {
  DashboardData, EntityTypeStat,
} from "./use-dashboard-data";
import type { ActivityEvent, HealthInfo, TrendPoint } from "@/lib/api";
import { cn } from "@/lib/utils";
import { parseTemplate, type TemplateKey } from "./canvas-config";

// 浮动画布里的 widget 首帧可能 0×0，此时 recharts ResponsiveContainer 会量到 width/height=-1
// 并刷一堆警告（#141）。用 ResizeObserver 等容器有正尺寸再挂图表。
function useChartReady<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setReady(width > 0 && height > 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ready };
}

// ═══════════════════════════════════════════════════════════════
// 设计 tokens — 仅保留 recharts 必须用字符串 fill / stroke 的场景
// ═══════════════════════════════════════════════════════════════
/**
 * recharts 的 <Area>/<Line>/<Pie> stroke / fill / Tooltip cursor 等 prop
 * 只接受字符串色值，不接受 Tailwind class。这些场景下用 CSS 变量字符串
 * 直接引用，自动适配 dark/light 主题。
 *
 * 其余所有 UI 部分（文字色、背景、边框）请使用 Tailwind class
 * （bg-card / text-ink / border-edge ...），不要再走 COLORS 映射。
 */
const CHART = {
  brand1: "var(--color-brand-1)",
  brand2: "var(--color-brand-2)",
  cyan:   "var(--color-cyan)",
  amber:  "var(--color-amber)",
  ok:     "var(--color-ok)",
  bad:    "var(--color-bad)",
  ink:    "var(--color-ink)",
  ink3:   "var(--color-ink-sub)",
  ink4:   "var(--color-ink-faint)",
  card:   "var(--color-card)",
  overlay:"var(--color-overlay)",
  edge:   "var(--color-edge)",
  edge2:  "var(--color-edge-mid)",
} as const;


// 菌丝调色（#109）：bio teal / lime / amber 暖调谱，取代通用 indigo/purple
const PIE_COLORS = [
  "#6ff5c8", "#c4f85a", "#eaa066", "#5fe3b4", "#a8d96b",
  "#d98a5a", "#8fd9c0", "#e0b87a", "#b0e85a", "#cf9a6a",
];

// ═══════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════
// #105：统一数字格式。≥1万用 locale 紧凑记法（zh→「10万」/ en→「10K」，
// 取代网络俚语「w」）；其余用千分位。locale 由运行时决定，与页面 next-intl 一致。
export function fmt(n: number) {
  if (n >= 10_000) {
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  return n.toLocaleString(undefined);
}
function pctSign(p: number) { return p > 0 ? `+${p}%` : `${p}%`; }
function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
  if (sec < 60)    return rtf.format(-sec, "second");
  if (sec < 3600)  return rtf.format(-Math.floor(sec / 60), "minute");
  if (sec < 86400) return rtf.format(-Math.floor(sec / 3600), "hour");
  return rtf.format(-Math.floor(sec / 86400), "day");
}

// ═══════════════════════════════════════════════════════════════
// 通用：标题栏 / 空态
// ═══════════════════════════════════════════════════════════════
export function WidgetHeader({ icon, title, href, sub }: {
  icon?: React.ReactNode; title: string; href?: string; sub?: string;
}) {
  const tCommon = useTranslations("common");
  return (
    <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-edge">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-ink-sub">{icon}</span>}
        <p className="text-sm font-semibold truncate text-ink-dim">{title}</p>
        {sub && <span className="text-2xs text-ink-faint">· {sub}</span>}
      </div>
      {href && (
        <Link
          href={href}
          className="flex items-center gap-0.5 text-2xs text-ink-sub no-underline hover:opacity-100 transition-opacity"
        >
          {tCommon("viewAll")} <ChevronRight size={10} />
        </Link>
      )}
    </div>
  );
}

export function WidgetEmpty({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-ink-faint">
      {text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 1) KPI Hero — 主指标 + 7 天 Area + 同比
// ═══════════════════════════════════════════════════════════════
export function KpiHero({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const { stats, trend, today } = data;
  const series = trend?.series ?? [];
  const todayTags = today?.tags;

  return (
    <div className="flex flex-col h-full p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-brand-2" />
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-sub">
            {t("kpiTitle")}
          </span>
        </div>
        {todayTags && todayTags.comparePct !== 0 && todayTags.comparePct > -100 && (
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
              todayTags.comparePct >= 0
                ? "bg-ok/10 border-ok/25 text-ok"
                : "bg-bad/10 border-bad/25 text-bad",
            )}
          >
            {todayTags.comparePct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            <span className="text-2xs font-bold tabular-nums">
              {pctSign(todayTags.comparePct)}
            </span>
          </div>
        )}
      </div>

      {/* 大数字 */}
      <div className="mt-6">
        <p
          className="font-extrabold leading-none tabular-nums text-display-2xl bg-clip-text"
          style={{
            letterSpacing: "-0.05em",
            backgroundImage: `linear-gradient(135deg, ${CHART.ink} 0%, ${CHART.brand2} 120%)`,
            WebkitTextFillColor: "transparent",
          }}
        >
          {fmt(stats.tags)}
        </p>
        <div className="flex items-baseline gap-3 mt-2">
          <span className="text-sm text-ink-sub">{t("kpiSub")}</span>
          {todayTags && (
            <span className="text-xs tabular-nums text-ink-sub">
              {t("kpiToday")} <span className="font-semibold text-ink">+{todayTags.today}</span>
            </span>
          )}
        </div>
      </div>

      {/* 7 天 Area 图 */}
      <KpiTrendArea series={series} loadingText={t("loadingTrend")} />
      <p className="text-2xs mt-1 tabular-nums text-ink-faint">
        {t("kpiTrend")}
      </p>
    </div>
  );
}

// KPI 卡片里的 7 天趋势 Area 图，带尺寸就绪门控（#141）
function KpiTrendArea({ series, loadingText }: { series: TrendPoint[]; loadingText: string }) {
  const { ref, ready } = useChartReady<HTMLDivElement>();
  return (
    <div ref={ref} className="flex-1 min-h-0 mt-4">
      {series.length === 0 || !ready ? <WidgetEmpty text={loadingText} /> : (
        <ResponsiveContainer width="100%" height="100%" minHeight={80}>
          <AreaChart data={series} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="kpi-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={CHART.brand2} stopOpacity={0.5} />
                <stop offset="100%" stopColor={CHART.brand2} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: CHART.edge2 }} />
            <Area type="monotone" dataKey="tags" stroke={CHART.brand2} strokeWidth={2}
              fill="url(#kpi-grad)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2) Entity Pie — 实体类型环形分布
// ═══════════════════════════════════════════════════════════════
export function EntityPie({ entityTypes, compact = false }: { entityTypes: EntityTypeStat[]; compact?: boolean }) {
  const t = useTranslations("dashboard");
  const total = entityTypes.reduce((s, et) => s + et.count, 0);
  // Filter out 0-count types — they carry no visual weight and confuse the legend
  const nonEmpty = entityTypes.filter(et => et.count > 0);
  const display = nonEmpty.slice(0, 8);
  if (nonEmpty.length > 8) {
    const rest = nonEmpty.slice(8).reduce((s, et) => s + et.count, 0);
    if (rest > 0) display.push({ entityType: t("entityPieOther"), count: rest });
  }

  // Build CSS conic-gradient for the donut ring.
  // recharts v3 PieChart fails to render in this layout (initial render with 0
  // dimensions, ResizeObserver fires after mount but sectors never re-render).
  // Pure CSS is simpler, zero-dependency, and handles single-100% trivially.
  let cumPct = 0;
  const gradientStops = display.map((d, i) => {
    const pct = total ? (d.count / total) * 100 : 0;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const stop = `${color} ${cumPct.toFixed(3)}% ${(cumPct + pct).toFixed(3)}%`;
    cumPct += pct;
    return stop;
  });
  // 2px gap between segments for multi-segment pies (transparent border-bg slice)
  const conicGradient = display.length > 1
    ? `conic-gradient(from -90deg, ${gradientStops.join(", ")})`
    : `conic-gradient(${PIE_COLORS[0]} 0% 100%)`;

  // 紧凑档（2×2）：只留环 + 中心数字，省去右侧图例（小尺寸放不下、会溢出）
  if (compact) {
    return (
      <div className="flex flex-col h-full p-2.5">
        <div className="flex items-center gap-1.5 shrink-0">
          <Box size={11} strokeWidth={1.5} className="text-ink-sub" />
          <span className="text-[0.5rem] font-semibold uppercase tracking-[0.1em] text-ink-sub truncate">{t("entityPieTitle")}</span>
        </div>
        {display.length === 0 ? <WidgetEmpty text={t("noEntityData")} /> : (
          <div className="flex-1 grid place-items-center min-h-0 relative">
            <div
              className="rounded-full"
              style={{
                width: "min(100%, 5.6rem)", aspectRatio: "1",
                background: conicGradient,
                mask: "radial-gradient(farthest-side, transparent 56%, black 58%)",
                WebkitMask: "radial-gradient(farthest-side, transparent 56%, black 58%)",
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="font-extrabold tabular-nums leading-none text-base text-ink" style={{ letterSpacing: "-0.04em" }}>{fmt(total)}</p>
              <p className="text-[0.5rem] mt-0.5 text-ink-sub">{t("statPieTypes", { count: nonEmpty.length })}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Box size={13} strokeWidth={1.5} />} title={t("entityPieTitle")} href="/entities" />
      {display.length === 0 ? <WidgetEmpty text={t("noEntityData")} /> : (
        <div className="flex-1 grid grid-cols-[1fr,1fr] gap-3 px-5 py-4 min-h-0 items-center">
          {/* CSS conic-gradient donut — no JS size-measurement required */}
          <div className="relative flex items-center justify-center min-h-0 h-full">
            <div
              className="rounded-full shrink-0"
              style={{
                width: "min(80%, 80%)",
                aspectRatio: "1",
                maxWidth: 160,
                background: conicGradient,
                mask:       "radial-gradient(farthest-side, transparent 56%, black 58%)",
                WebkitMask: "radial-gradient(farthest-side, transparent 56%, black 58%)",
              }}
            />
            {/* Center text overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-2xs uppercase tracking-wider text-ink-faint">{t("statPieTotal")}</p>
              <p
                className="font-extrabold tabular-nums leading-none mt-1 text-display-lg text-ink"
                style={{ letterSpacing: "-0.04em" }}
              >
                {fmt(total)}
              </p>
              <p className="text-2xs mt-1 text-ink-sub">
                {t("statPieTypes", { count: nonEmpty.length })}
              </p>
            </div>
          </div>
          {/* 图例列表 */}
          <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto pr-1 self-center">
            {display.map((et, i) => {
              const pct = total ? Math.round((et.count / total) * 100) : 0;
              const pctLabel = pct === 0 && et.count > 0 ? "< 1%" : `${pct}%`;
              return (
                <div key={et.entityType} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="flex-1 truncate font-mono text-ink-dim">{et.entityType}</span>
                  <span className="tabular-nums shrink-0 text-ink-sub">{pctLabel}</span>
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
    <div className="text-xs px-3 py-2 rounded-lg border border-edge-mid shadow-lg shadow-black/40 bg-overlay">
      <p className="font-mono mb-1 text-ink-sub">{p.date.slice(5)}</p>
      {payload.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-sm" style={{ background: it.color }} />
          <span className="text-ink-dim">{it.name}</span>
          <span className="font-mono tabular-nums text-ink">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const series = data.trend?.series ?? [];
  // 始终渲染测量容器，待其有正尺寸再挂图表，避免 ResponsiveContainer 量到 -1（#141）
  const { ref, ready } = useChartReady<HTMLDivElement>();
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Activity size={13} strokeWidth={1.5} />} title={t("trendTitle")} sub={t("trendSub")} />
      <div ref={ref} className="flex-1 min-h-0 p-3">
        {series.length === 0 || !ready ? <WidgetEmpty text={t("loadingTrend")} /> : (
          <ResponsiveContainer width="100%" height="100%" minHeight={80}>
            <LineChart data={series} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
              <XAxis dataKey="date" tickFormatter={d => d.slice(5)} stroke={CHART.ink4}
                tick={{ fontSize: 10, fill: CHART.ink3 }} axisLine={false} tickLine={false} />
              <YAxis stroke={CHART.ink4} tick={{ fontSize: 10, fill: CHART.ink3 }}
                axisLine={false} tickLine={false} width={42} tickFormatter={fmt} allowDecimals={false}
                domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.2) || 10]}
                allowDataOverflow={false} />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: CHART.edge2, strokeDasharray: 4 }} />
              <Line type="monotone" dataKey="tags"     name={t("trendTagsLine")}     stroke={CHART.brand2} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="entities" name={t("trendEntitiesLine")} stroke={CHART.cyan}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="reviews"  name={t("trendReviewsLine")}  stroke={CHART.amber}  strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      {/* 图例 */}
      <div className="flex items-center justify-center gap-4 px-4 pb-3 shrink-0">
        {[
          { c: CHART.brand2, l: t("trendTagsLine") },
          { c: CHART.cyan,   l: t("trendEntitiesLine") },
          { c: CHART.amber,  l: t("trendReviewsLine") },
        ].map(x => (
          <div key={x.l} className="flex items-center gap-1.5 text-2xs text-ink-sub">
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
// 菌丝调色（#109 step3）：bio teal / lime / 深 teal / 暖琥珀，取代旧 indigo/purple/cyan
const STAT_CONFIG = {
  "stat-groups":   { color: "#6ff5c8", icon: Layers,         href: "/groups",   metric: "groups",   trendKey: null            as "tags" | "entities" | "reviews" | null },
  "stat-tags":     { color: "#c4f85a", icon: Tag,            href: "/groups",   metric: "tags",     trendKey: "tags"          as const },
  "stat-entities": { color: "#5fe3b4", icon: Box,            href: "/entities", metric: "entities", trendKey: "entities"      as const },
  "stat-pending":  { color: "#eaa066", icon: ClipboardCheck, href: "/audit",    metric: "pending",  trendKey: null            as "tags" | "entities" | "reviews" | null },
} as const;

export function StatMini({ id, data }: { id: keyof typeof STAT_CONFIG; data: DashboardData }) {
  const t = useTranslations("dashboard");
  const config = STAT_CONFIG[id];
  const Icon   = config.icon;
  const label  = id === "stat-groups"   ? t("statsGroupsTitle")
               : id === "stat-tags"     ? t("statsTagsTitle")
               : id === "stat-entities" ? t("statsEntitiesTitle")
               :                          t("statsAuditsTitle");
  const value = data.stats[config.metric as keyof typeof data.stats];
  const today = config.metric === "tags"     ? data.today?.tags
              : config.metric === "entities" ? data.today?.entities
              : config.metric === "pending"  ? data.today?.audits
              : null;
  const spark = config.trendKey ? (data.trend?.series ?? []).map(s => ({ v: s[config.trendKey!] })) : null;
  const isAlert = id === "stat-pending" && value > 0;

  return (
    <Link href={config.href} className="flex flex-col h-full p-4 group relative overflow-hidden no-underline">
      {/* 角落淡色装饰 */}
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none transition-opacity duration-300 opacity-30 group-hover:opacity-50"
        style={{ background: `radial-gradient(circle, ${config.color}40, transparent 70%)` }} />

      {/* 顶部：图标 + 标签 + 同比 */}
      <div className="flex items-start justify-between gap-2 shrink-0 relative z-10">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg border"
            style={{ background: `${config.color}1F`, color: config.color, borderColor: `${config.color}33` }}>
            <Icon size={13} strokeWidth={1.8} />
          </span>
          <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-ink-sub">
            {label}
          </span>
        </div>
        {today && today.comparePct !== 0 && today.comparePct > -100 && (
          <span className={cn(
            "text-2xs font-bold tabular-nums flex items-center gap-0.5",
            today.comparePct >= 0 ? "text-ok" : "text-bad",
          )}>
            {today.comparePct >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {pctSign(today.comparePct)}
          </span>
        )}
      </div>

      {/* 大数字 */}
      <div className="flex-1 flex flex-col justify-center relative z-10">
        <p
          className={cn(
            "font-extrabold tabular-nums leading-none text-display-xl",
            !isAlert && "text-ink",
          )}
          style={{
            letterSpacing: "-0.04em",
            ...(isAlert && { color: config.color }),
          }}
        >
          {fmt(value)}
        </p>
        {today ? (
          <p className="text-2xs mt-1.5 tabular-nums text-ink-sub">
            {t("statTodayNew", { n: today.today })}
          </p>
        ) : id === "stat-groups" && data.stats.groups > 0 ? (
          <p className="text-2xs mt-1.5 tabular-nums text-ink-sub">
            {t("statGroupsAvg", { n: Math.round(data.stats.tags / data.stats.groups) })}
          </p>
        ) : null}
      </div>

      {/* Sparkline */}
      {spark && spark.length > 0 && (
        <div className="h-7 -mx-1 relative z-10">
          <ResponsiveContainer width="100%" height="100%" minHeight={28}>
            <AreaChart data={spark} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={config.color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={config.color} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={config.color} strokeWidth={1.5}
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
export function ActivityFeed({ activity }: { activity: ActivityEvent[] }) {
  const t = useTranslations("dashboard");
  const tAudit = useTranslations("audit");

  const sourceLabel = (source: string) => {
    const map: Record<string, string> = {
      ai:     tAudit("sourceAi"),
      manual: tAudit("sourceManual"),
      system: tAudit("sourceSystem"),
      import: tAudit("sourceImport"),
    };
    return map[source] ?? source;
  };

  const SOURCE_COLOR: Record<string, string> = {
    manual: "#6ff5c8",  // bio teal
    ai:     "#c4f85a",  // 孢子 lime
    system: "#5fe3b4",  // 深 teal
    import: "#eaa066",  // 暖琥珀
  };

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Activity size={13} strokeWidth={1.5} />} title={t("activityTitle")} sub={t("activityCount", { count: activity.length })} />
      {activity.length === 0 ? <WidgetEmpty text={t("noActivity")} /> : (
        <ul className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {activity.map((ev, i) => (
            <li
              key={`${ev.kind}-${ev.time}-${i}`}
              className="px-3 py-2 rounded-md text-xs transition-colors hover:bg-surface-alt animate-slide-up"
              style={{ animationDelay: `${Math.min(i, 7) * 25}ms` }}
            >
              <div className="flex items-center gap-2">
                {ev.kind === "tag-added" ? (
                  <span
                    className="text-2xs font-bold px-1.5 py-0.5 rounded font-mono shrink-0"
                    style={{
                      background: `${SOURCE_COLOR[ev.source] ?? "#fff"}1F`,
                      color: SOURCE_COLOR[ev.source] ?? "#fff",
                    }}
                  >
                    {sourceLabel(ev.source)}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-2xs font-bold px-1.5 py-0.5 rounded font-mono shrink-0",
                      ev.toStatus === "active" ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad",
                    )}
                  >
                    {ev.toStatus === "active" ? t("activityApproved") : t("activityRejected")}
                  </span>
                )}
                <span className="font-mono text-2xs truncate text-ink">{ev.tagName}</span>
                <span className="text-2xs ml-auto shrink-0 tabular-nums text-ink-faint">
                  {timeAgo(ev.time)}
                </span>
              </div>
              <p className="text-2xs mt-0.5 truncate font-mono text-ink-sub">
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
  const t = useTranslations("dashboard");
  const cells: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t("healthService"),
      value: <Dot ok={health?.status === "ok"} text={health?.status === "ok" ? t("healthOnline") : t("healthError")} />,
    },
    {
      label: t("healthDb"),
      value: <Dot ok={health?.db === "ok"} text={health?.db === "ok" ? t("healthOk") : t("healthError")} />,
    },
    {
      label: t("healthVersion"),
      value: <span className="font-mono text-base font-semibold text-ink">
        {health?.version && health.version !== "unknown" ? `v${health.version}` : "—"}
      </span>,
    },
    {
      label: t("healthNodeJs"),
      value: <span className="font-mono text-sm text-ink-dim">
        {health?.nodeVersion ?? "—"}
      </span>,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<CheckCircle2 size={13} strokeWidth={1.5} />} title={t("healthTitle")} />
      <div className="flex-1 grid grid-cols-4 min-h-0">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={cn(
              "flex flex-col justify-center gap-1 px-4",
              i < cells.length - 1 && "border-r border-edge",
            )}
          >
            <p className="text-2xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
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
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-sm font-semibold",
      ok ? "text-ok" : "text-bad",
    )}>
      <span
        className={cn(
          "inline-block w-1.5 h-1.5 rounded-full",
          ok ? "bg-ok shadow-[0_0_6px_var(--color-ok)]" : "bg-bad shadow-[0_0_6px_var(--color-bad)]",
        )}
      />
      {text}
    </span>
  );
}


// ═══════════════════════════════════════════════════════════════
// 7) Canvas KPI — 单指标，按模板宽度自适应（1×1 紧凑 / 2×1 带今日）
// ═══════════════════════════════════════════════════════════════
function CanvasKpi({ id, data }: { id: keyof typeof STAT_CONFIG; wide?: boolean; data: DashboardData }) {
  const t = useTranslations("dashboard");
  const config = STAT_CONFIG[id];
  const Icon   = config.icon;
  const label  = id === "stat-groups"   ? t("statsGroupsTitle")
               : id === "stat-tags"     ? t("statsTagsTitle")
               : id === "stat-entities" ? t("statsEntitiesTitle")
               :                          t("statsAuditsTitle");
  const value = data.stats[config.metric as keyof typeof data.stats];
  const today = config.metric === "tags"     ? data.today?.tags
              : config.metric === "entities" ? data.today?.entities
              : config.metric === "pending"  ? data.today?.audits
              : null;
  const isAlert = id === "stat-pending" && value > 0;

  return (
    <div className="flex flex-col h-full justify-between p-3.5 overflow-hidden relative">
      {/* 角落装饰光晕 */}
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${config.color}30, transparent 70%)` }} />
      {/* 标签行 */}
      <div className="flex items-center gap-1.5 min-w-0 relative z-10">
        <span className="p-1 rounded-md shrink-0"
          style={{ background: `${config.color}22`, color: config.color }}>
          <Icon size={13} strokeWidth={1.8} />
        </span>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.08em] truncate" style={{ color: "var(--myc-dim)" }}>{label}</span>
      </div>
      {/* 大数字 */}
      <div className="relative z-10">
        <p className="font-extrabold tabular-nums leading-none"
          style={{ fontSize: "1.85rem", letterSpacing: "-0.04em", color: isAlert ? config.color : "var(--myc-cream)" }}>
          {fmt(value)}
        </p>
        {today && (
          <p className="text-[0.58rem] mt-1 tabular-nums" style={{ color: "var(--myc-dim)" }}>
            {t("statTodayNew", { n: today.today })}
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 8) Trend Mini — 2×1 紧凑趋势（单线 area + 同比），大模板才上三线 TrendChart
// ═══════════════════════════════════════════════════════════════
function TrendMini({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard");
  const series = data.trend?.series ?? [];
  const today = data.today?.tags;
  return (
    <div className="flex flex-col h-full p-3">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <TrendingUp size={12} className="text-brand-2" />
          <span className="text-[0.5rem] font-semibold uppercase tracking-[0.12em] text-ink-sub">{t("trendTitle")}</span>
        </div>
        {today && today.comparePct !== 0 && today.comparePct > -100 && (
          <span className={cn("text-[0.55rem] font-bold tabular-nums", today.comparePct >= 0 ? "text-ok" : "text-bad")}>
            {pctSign(today.comparePct)}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 mt-1">
        {series.length === 0 ? <WidgetEmpty text={t("loadingTrend")} /> : (
          <ResponsiveContainer width="100%" height="100%" minHeight={32}>
            <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="trendmini-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.brand2} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={CHART.brand2} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="tags" stroke={CHART.brand2} strokeWidth={1.8} fill="url(#trendmini-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Canvas 分发：按 widget id + 模板尺寸渲染最合适的形态
// ═══════════════════════════════════════════════════════════════
export function renderCanvasWidget(id: string, tpl: TemplateKey, data: DashboardData) {
  const { w } = parseTemplate(tpl);
  switch (id) {
    case "stat-groups":   return <CanvasKpi id="stat-groups"   wide={w >= 2} data={data} />;
    case "stat-tags":     return <CanvasKpi id="stat-tags"     wide={w >= 2} data={data} />;
    case "stat-entities": return <CanvasKpi id="stat-entities" wide={w >= 2} data={data} />;
    case "stat-pending":  return <CanvasKpi id="stat-pending"  wide={w >= 2} data={data} />;
    case "trend-chart":   return w <= 2 ? <TrendMini data={data} /> : <TrendChart data={data} />;
    case "entity-pie":    return <EntityPie entityTypes={data.entityTypes} compact={w <= 2} />;
    case "activity-feed": return <ActivityFeed activity={data.activity} />;
    case "health-bar":    return <HealthBar health={data.health} />;
    default:              return <UnknownWidget id={id} />;
  }
}

function UnknownWidget({ id }: { id: string }) {
  const t = useTranslations("dashboard");
  return <WidgetEmpty text={t("unknownWidget", { id })} />;
}

// 临时引用消除 unused 警告
void AlertCircle;
void KpiHero;
