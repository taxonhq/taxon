"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Layers, Box, ClipboardCheck, Tag,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  ChevronRight, TrendingUp,
} from "lucide-react";
import {
  getTagGroups, getEntityTypes, getAuditItems, getHealth,
  type HealthInfo,
} from "@/lib/api";

// ─── 类型 ─────────────────────────────────────────────────────────

interface Stats {
  groups:   number;
  tags:     number;
  entities: number;
  pending:  number;
}

interface EntityTypeStat { entityType: string; count: number }
interface GroupStat      { id: string; name: string; tags: number }

interface DashData {
  stats:       Stats;
  entityTypes: EntityTypeStat[];
  topGroups:   GroupStat[];
  health:      HealthInfo | null;
}

// ─── 工具函数 ──────────────────────────────────────────────────────

function fmt(n: number) {
  return n >= 10000
    ? `${(n / 10000).toFixed(1)}w`
    : n.toLocaleString("zh-CN");
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── 主组件 ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData]           = useState<DashData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

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

    const topGroups: GroupStat[] = (groups?.items ?? [])
      .map(g => ({ id: g.id, name: g.name, tags: g._count?.tags ?? 0 }))
      .sort((a, b) => b.tags - a.tags)
      .slice(0, 6);

    setData({
      stats: {
        groups:   groups?.total ?? 0,
        tags:     totalTags,
        entities: totalEntities,
        pending:  auditPage?.total ?? 0,
      },
      entityTypes: [...types].sort((a, b) => b.count - a.count),
      topGroups,
      health,
    });

    setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <DashSkeleton />;

  const { stats, entityTypes, topGroups, health } = data!;
  const maxEntityCount = Math.max(...entityTypes.map(t => t.count), 1);

  return (
    <div className="space-y-7 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-end justify-between pb-7 border-b border-edge">
        <div>
          <h1
            className="text-[30px] font-extrabold text-ink leading-none"
            style={{ letterSpacing: "-0.04em" }}
          >
            仪表盘
          </h1>
          <p className="text-[13px] text-ink-sub mt-2">Taxon 标签服务全局概览</p>
        </div>
        <div className="flex items-center gap-3 pb-0.5">
          {updatedAt && (
            <span className="text-[11px] text-ink-faint tabular-nums">
              更新于 {fmtTime(updatedAt.toISOString())}
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
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          href="/groups"
          icon={<Layers size={15} strokeWidth={1.5} />}
          label="标签分组"
          value={fmt(stats.groups)}
          sub="个维度"
        />
        <StatCard
          href="/groups"
          icon={<Tag size={15} strokeWidth={1.5} />}
          label="标签总数"
          value={fmt(stats.tags)}
          sub="个标签值"
        />
        <StatCard
          href="/entities"
          icon={<Box size={15} strokeWidth={1.5} />}
          label="已注册实体"
          value={fmt(stats.entities)}
          sub={`${entityTypes.length} 种类型`}
        />
        <StatCard
          href="/audit"
          icon={<ClipboardCheck size={15} strokeWidth={1.5} />}
          label="待审核"
          value={fmt(stats.pending)}
          sub="条 AI 标签"
          alert={stats.pending > 0}
        />
      </div>

      {/* ── Mid row: entity distribution + top groups ── */}
      <div className="grid grid-cols-5 gap-4">

        {/* Entity type distribution */}
        <div className="col-span-3 card-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
            <div className="flex items-center gap-2">
              <Box size={13} className="text-ink-faint" strokeWidth={1.5} />
              <p className="text-[13px] font-semibold text-ink">实体类型分布</p>
            </div>
            <Link
              href="/entities"
              className="flex items-center gap-0.5 text-[11px] text-ink-faint hover:text-ink transition-colors"
            >
              全部 <ChevronRight size={11} />
            </Link>
          </div>

          {entityTypes.length === 0 ? (
            <div className="py-14 flex items-center justify-center text-[12px] text-ink-faint">
              暂无实体数据
            </div>
          ) : (
            <div className="px-5 py-4 space-y-3.5">
              {entityTypes.map((t, i) => {
                const pct = Math.round((t.count / maxEntityCount) * 100);
                return (
                  <Link
                    key={t.entityType}
                    href={`/entities/${encodeURIComponent(t.entityType)}`}
                    className="group flex items-center gap-3 animate-slide-up"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <span className="w-[110px] shrink-0 font-mono text-[12px] text-ink-sub group-hover:text-ink transition-colors truncate">
                      {t.entityType}
                    </span>
                    <div className="flex-1 h-[6px] bg-edge rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/20 group-hover:bg-white/35 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[12px] text-ink-dim tabular-nums shrink-0">
                      {fmt(t.count)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Top tag groups by tag count */}
        <div className="col-span-2 card-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
            <div className="flex items-center gap-2">
              <TrendingUp size={13} className="text-ink-faint" strokeWidth={1.5} />
              <p className="text-[13px] font-semibold text-ink">分组标签量</p>
            </div>
            <Link
              href="/groups"
              className="flex items-center gap-0.5 text-[11px] text-ink-faint hover:text-ink transition-colors"
            >
              全部 <ChevronRight size={11} />
            </Link>
          </div>

          {topGroups.length === 0 ? (
            <div className="py-14 flex items-center justify-center text-[12px] text-ink-faint">
              暂无分组数据
            </div>
          ) : (
            <div className="divide-y divide-edge">
              {topGroups.map((g, i) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-[#0E0E0E] transition-colors group animate-fade-in"
                  style={{ animationDelay: `${i * 25}ms` }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[11px] text-ink-faint/40 tabular-nums w-4 text-right shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-[12px] text-ink-sub group-hover:text-ink transition-colors truncate">
                      {g.name}
                    </span>
                  </div>
                  <span
                    className="text-[15px] font-extrabold text-ink tabular-nums shrink-0 ml-3"
                    style={{ letterSpacing: "-0.03em" }}
                  >
                    {fmt(g.tags)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Pending audit alert ── */}
      {stats.pending > 0 && (
        <Link
          href="/audit"
          className="flex items-center justify-between px-5 py-3.5 rounded-xl border border-warn/20 bg-warn/[.04] hover:bg-warn/[.08] hover:border-warn/35 transition-all group animate-slide-up"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={14} className="text-warn shrink-0" />
            <p className="text-[13px] font-medium text-ink-sub group-hover:text-ink transition-colors">
              有{" "}
              <span className="text-warn font-bold tabular-nums">{stats.pending}</span>
              {" "}条 AI 标签待人工审核
            </p>
          </div>
          <span className="flex items-center gap-1 text-[12px] text-ink-faint group-hover:text-ink transition-colors">
            前往审核 <ChevronRight size={12} />
          </span>
        </Link>
      )}

      {/* ── Service health ── */}
      <div className="card-border overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-edge">
          <CheckCircle2 size={13} className="text-ink-faint" strokeWidth={1.5} />
          <p className="text-[13px] font-semibold text-ink">服务状态</p>
        </div>
        <div className="grid grid-cols-4 divide-x divide-edge">
          <HealthCell label="服务" value={
            health
              ? <StatusDot ok={health.status === "ok"} text={health.status === "ok" ? "正常" : "异常"} />
              : <StatusDot ok={false} text="无法连接" />
          } />
          <HealthCell label="数据库" value={
            health
              ? <StatusDot ok={health.db === "ok"} text={health.db === "ok" ? "正常" : "异常"} />
              : <StatusDot ok={false} text="未知" />
          } />
          <HealthCell label="服务版本" value={
            <span className="font-mono text-[12px] text-ink">
              {health?.version ? `v${health.version}` : "—"}
            </span>
          } />
          <HealthCell label="Node.js" value={
            <span className="font-mono text-[12px] text-ink">{health?.nodeVersion ?? "—"}</span>
          } />
        </div>
      </div>

    </div>
  );
}

// ─── 子组件 ───────────────────────────────────────────────────────

function StatCard({
  href, icon, label, value, sub, alert = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card-border overflow-hidden p-5 flex flex-col gap-4 group transition-all ${
        alert ? "border-warn/20 hover:border-warn/40" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-medium uppercase tracking-[0.08em] ${
          alert ? "text-warn/70" : "text-ink-faint"
        }`}>
          {label}
        </span>
        <span className={`p-1.5 rounded-lg transition-colors ${
          alert ? "text-warn bg-warn/10" : "text-ink-faint bg-surface-alt group-hover:text-ink-dim"
        }`}>
          {icon}
        </span>
      </div>
      <div>
        <p
          className={`text-[32px] font-extrabold leading-none ${alert ? "text-warn" : "text-ink"}`}
          style={{ letterSpacing: "-0.04em" }}
        >
          {value}
        </p>
        {sub && <p className="text-[11px] text-ink-faint mt-1.5">{sub}</p>}
      </div>
    </Link>
  );
}

function HealthCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5 flex flex-col gap-1.5">
      <p className="text-[10px] text-ink-faint uppercase tracking-[0.08em]">{label}</p>
      <div>{value}</div>
    </div>
  );
}

function StatusDot({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${ok ? "text-ok" : "text-bad"}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {text}
    </span>
  );
}

function DashSkeleton() {
  return (
    <div className="space-y-7 animate-pulse">
      <div className="pb-7 border-b border-edge">
        <div className="h-8 w-32 bg-edge-mid rounded" />
        <div className="h-3.5 w-48 bg-edge rounded mt-3" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="card-border overflow-hidden p-5 space-y-4">
            <div className="flex justify-between">
              <div className="h-3 w-16 bg-edge rounded" />
              <div className="h-6 w-6 bg-edge-mid rounded-lg" />
            </div>
            <div>
              <div className="h-8 w-20 bg-edge-mid rounded" />
              <div className="h-3 w-12 bg-edge rounded mt-2" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 card-border overflow-hidden">
          <div className="px-5 py-4 border-b border-edge">
            <div className="h-4 w-24 bg-edge-mid rounded" />
          </div>
          <div className="px-5 py-4 space-y-3.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-24 bg-edge-mid rounded" />
                <div className="flex-1 h-[6px] bg-edge rounded-full" />
                <div className="h-3 w-8 bg-edge rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-2 card-border overflow-hidden">
          <div className="px-5 py-4 border-b border-edge">
            <div className="h-4 w-20 bg-edge-mid rounded" />
          </div>
          <div className="divide-y divide-edge">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <div className="h-3 w-20 bg-edge-mid rounded" />
                <div className="h-4 w-8 bg-edge rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
