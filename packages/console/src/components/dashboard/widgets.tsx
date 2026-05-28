/**
 * Dashboard widgets 集合
 *
 * 所有可视化组件统一管理，便于维护配色和共用工具。
 * 配色遵循 Brand Gradient（蓝紫渐变）+ Cyan/Amber 辅色 + 暗色 elevation 层级。
 */

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
import { cn } from "@/lib/utils";

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


const PIE_COLORS = [
  "#6366f1", "#a855f7", "#06b6d4", "#f59e0b", "#22c55e",
  "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#8b5cf6",
];

// ═══════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════
export function fmt(n: number) {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}w`;
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
        {todayTags && (
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
      <div className="flex-1 min-h-0 mt-4">
        {series.length === 0 ? <WidgetEmpty text={t("loadingTrend")} /> : (
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
      <p className="text-2xs mt-1 tabular-nums text-ink-faint">
        {t("kpiTrend")}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 2) Entity Pie — 实体类型环形分布
// ═══════════════════════════════════════════════════════════════
export function EntityPie({ entityTypes }: { entityTypes: EntityTypeStat[] }) {
  const t = useTranslations("dashboard");
  const total = entityTypes.reduce((s, et) => s + et.count, 0);
  const display = entityTypes.slice(0, 8);
  // Collapse remaining items into "Other"
  if (entityTypes.length > 8) {
    const rest = entityTypes.slice(8).reduce((s, et) => s + et.count, 0);
    if (rest > 0) display.push({ entityType: t("entityPieOther"), count: rest });
  }

  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Box size={13} strokeWidth={1.5} />} title={t("entityPieTitle")} href="/entities" />
      {display.length === 0 ? <WidgetEmpty text={t("noEntityData")} /> : (
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
              <p className="text-2xs uppercase tracking-wider text-ink-faint">{t("statPieTotal")}</p>
              <p
                className="font-extrabold tabular-nums leading-none mt-1 text-display-lg text-ink"
                style={{ letterSpacing: "-0.04em" }}
              >
                {fmt(total)}
              </p>
              <p className="text-2xs mt-1 text-ink-sub">
                {t("statPieTypes", { count: entityTypes.length })}
              </p>
            </div>
          </div>
          {/* 图例列表 */}
          <div className="flex flex-col gap-1.5 min-h-0 overflow-y-auto pr-1">
            {display.map((et, i) => {
              const pct = total ? Math.round((et.count / total) * 100) : 0;
              return (
                <div key={et.entityType} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="flex-1 truncate font-mono text-ink-dim">{et.entityType}</span>
                  <span className="tabular-nums shrink-0 text-ink-sub">{pct}%</span>
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
  return (
    <div className="flex flex-col h-full">
      <WidgetHeader icon={<Activity size={13} strokeWidth={1.5} />} title={t("trendTitle")} sub={t("trendSub")} />
      {series.length === 0 ? <WidgetEmpty text={t("loadingTrend")} /> : (
        <div className="flex-1 min-h-0 p-3">
          <ResponsiveContainer width="100%" height="100%" minHeight={80}>
            <LineChart data={series} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
              <XAxis dataKey="date" tickFormatter={d => d.slice(5)} stroke={CHART.ink4}
                tick={{ fontSize: 10, fill: CHART.ink3 }} axisLine={false} tickLine={false} />
              <YAxis stroke={CHART.ink4} tick={{ fontSize: 10, fill: CHART.ink3 }}
                axisLine={false} tickLine={false} width={30} />
              <Tooltip content={<TrendTooltip />} cursor={{ stroke: CHART.edge2, strokeDasharray: 4 }} />
              <Line type="monotone" dataKey="tags"     name={t("trendTagsLine")}     stroke={CHART.brand2} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="entities" name={t("trendEntitiesLine")} stroke={CHART.cyan}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="reviews"  name={t("trendReviewsLine")}  stroke={CHART.amber}  strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
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
const STAT_CONFIG = {
  "stat-groups":   { color: "#6366f1", icon: Layers,         href: "/groups",   metric: "groups",   trendKey: null            as "tags" | "entities" | "reviews" | null },
  "stat-tags":     { color: "#a855f7", icon: Tag,            href: "/groups",   metric: "tags",     trendKey: "tags"          as const },
  "stat-entities": { color: "#06b6d4", icon: Box,            href: "/entities", metric: "entities", trendKey: "entities"      as const },
  "stat-pending":  { color: "#f59e0b", icon: ClipboardCheck, href: "/audit",    metric: "pending",  trendKey: null            as "tags" | "entities" | "reviews" | null },
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
        {today && today.comparePct !== 0 && (
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
        {today && (
          <p className="text-2xs mt-1.5 tabular-nums text-ink-sub">
            {t("statTodayNew", { n: today.today })}
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
    manual: "#06b6d4",
    ai:     "#a855f7",
    system: "#22c55e",
    import: "#f59e0b",
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
        {health?.version ? `v${health.version}` : "—"}
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
    <div className="text-xs px-3 py-2 rounded-lg bg-overlay border border-edge-mid">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-sm" style={{ background: p.payload.fill }} />
        <span className="font-mono text-ink">{p.name}</span>
      </div>
      <p className="font-mono tabular-nums mt-0.5 text-ink-dim">
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
    default: return <UnknownWidget id={id} />;
  }
}

function UnknownWidget({ id }: { id: string }) {
  const t = useTranslations("dashboard");
  return <WidgetEmpty text={t("unknownWidget", { id })} />;
}

// 临时引用消除 unused 警告
void AlertCircle;
