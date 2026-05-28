"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  RefreshCw, Trash2, Merge, ExternalLink,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import {
  getTagUsage, getDeadTags, getDuplicateSuggestions, mergeTags,
  deleteTag,
  type TagUsageItem, type DeadTagItem, type DuplicatePair,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────────

function SectionCard({
  title, subtitle, children, extra,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <section className="card-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-edge bg-surface-alt/40">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center py-14 text-sm text-ink-faint">
      <CheckCircle2 size={14} className="mr-2 text-ok" /> {msg}
    </div>
  );
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-3 bg-surface-alt rounded animate-pulse" style={{ width: `${60 + (i * 7 + j * 13) % 35}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Usage Leaderboard ─────────────────────────────────────────────────────────

type UsagePeriod = "7d" | "30d" | "90d" | "all";

function UsagePanel() {
  const t = useTranslations("governance");

  const [items, setItems]   = useState<TagUsageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState<UsagePeriod>("30d");
  const [order, setOrder]     = useState<"desc" | "asc">("desc");

  const relativeTime = useCallback((iso: string | null): string => {
    if (!iso) return t("neverUsed");
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return t("today");
    if (days === 1) return t("yesterday");
    if (days < 30)  return t("daysAgo", { n: days });
    const months = Math.floor(days / 30);
    if (months < 12) return t("monthsAgo", { n: months });
    return t("yearsAgo", { n: Math.floor(months / 12) });
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTagUsage({ period, order, limit: 50 });
      setItems(res.items);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [period, order]);

  useEffect(() => { void load(); }, [load]);

  const PERIODS: { v: UsagePeriod; label: string }[] = [
    { v: "7d",  label: t("period7d") },
    { v: "30d", label: t("period30d") },
    { v: "90d", label: t("period90d") },
    { v: "all", label: t("periodAll") },
  ];

  return (
    <SectionCard
      title={t("usagePanelTitle")}
      subtitle={t("usagePanelDesc")}
      extra={
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as UsagePeriod)}
            className="text-xs border border-edge rounded-md px-2 py-1 bg-surface text-ink-dim focus:outline-none focus:border-brand"
          >
            {PERIODS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <button
            onClick={() => setOrder(o => o === "desc" ? "asc" : "desc")}
            className="flex items-center gap-1 text-xs border border-edge rounded-md px-2 py-1 bg-surface text-ink-dim hover:bg-surface-alt transition-colors"
            title={order === "desc" ? t("orderDesc") : t("orderAsc")}
          >
            {order === "desc" ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
            {order === "desc" ? t("orderMost") : t("orderLeast")}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-edge text-ink-faint">
              <th className="px-4 py-2.5 text-left font-medium w-8">#</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("colTag")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("colGroup")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colUsageCount")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("colLastUsed")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {loading && <LoadingRows cols={5} />}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5}><EmptyState msg={t("noUsageData")} /></td></tr>
            )}
            {!loading && items.map((item, idx) => (
              <tr key={item.tagId} className="hover:bg-surface-alt/40 transition-colors">
                <td className="px-4 py-3 text-ink-faint tabular-nums">{idx + 1}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{item.name}</div>
                  <div className="text-ink-faint font-mono text-2xs mt-0.5">{item.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/groups/${item.groupId}`}
                    className="flex items-center gap-1 text-ink-dim hover:text-ink transition-colors"
                  >
                    {item.groupName}
                    <ExternalLink size={10} className="opacity-50" />
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-ink">
                  {item.usageCount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-ink-faint">
                  {relativeTime(item.lastUsedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ── Dead Tags Panel ───────────────────────────────────────────────────────────

type DeadPeriod = "30d" | "90d" | "180d" | "1y";

function DeadTagsPanel() {
  const t = useTranslations("governance");

  const [items, setItems]     = useState<DeadTagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState<DeadPeriod>("90d");
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const relativeTime = useCallback((iso: string | null): string => {
    if (!iso) return t("neverUsed");
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return t("today");
    if (days === 1) return t("yesterday");
    if (days < 30)  return t("daysAgo", { n: days });
    const months = Math.floor(days / 30);
    if (months < 12) return t("monthsAgo", { n: months });
    return t("yearsAgo", { n: Math.floor(months / 12) });
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDeadTags({ period, limit: 100 });
      setItems(res.items);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (item: DeadTagItem) => {
    if (!confirm(t("deleteTagConfirm", { name: item.name }))) return;
    setDeleting(prev => new Set(prev).add(item.tagId));
    try {
      await deleteTag(item.tagId);
      toast.success(t("deleteTagSuccess", { name: item.name }));
      setItems(prev => prev.filter(i => i.tagId !== item.tagId));
    } catch (err) {
      toast.error(t("deleteTagFailedMsg", { message: (err as Error).message }));
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(item.tagId); return s; });
    }
  };

  const PERIODS: { v: DeadPeriod; label: string }[] = [
    { v: "30d",  label: t("period30dDead") },
    { v: "90d",  label: t("period90dDead") },
    { v: "180d", label: t("period180dDead") },
    { v: "1y",   label: t("period1yDead") },
  ];

  return (
    <SectionCard
      title={t("deadPanelTitle")}
      subtitle={t("deadPanelDesc")}
      extra={
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as DeadPeriod)}
            className="text-xs border border-edge rounded-md px-2 py-1 bg-surface text-ink-dim focus:outline-none focus:border-brand"
          >
            {PERIODS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-edge text-ink-faint">
              <th className="px-4 py-2.5 text-left font-medium">{t("colTag")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("colGroup")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colEntities")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("colLastUsed")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("colLevel")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {loading && <LoadingRows cols={6} />}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6}><EmptyState msg={t("noDeadTagsPeriod", { period })} /></td></tr>
            )}
            {!loading && items.map(item => (
              <tr key={item.tagId} className="hover:bg-surface-alt/40 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{item.name}</div>
                  <div className="text-ink-faint font-mono text-2xs mt-0.5">{item.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/groups/${item.groupId}`}
                    className="flex items-center gap-1 text-ink-dim hover:text-ink transition-colors"
                  >
                    {item.groupName}
                    <ExternalLink size={10} className="opacity-50" />
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-dim">
                  {item.activeCount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-ink-faint">
                  {relativeTime(item.lastUsedAt)}
                </td>
                <td className="px-4 py-3 text-ink-faint">
                  {item.depth === 0 ? (
                    <span className="px-1.5 py-0.5 rounded text-2xs bg-surface-alt border border-edge">{t("rootNodeLabel")}</span>
                  ) : `L${item.depth}`}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(item)}
                    disabled={deleting.has(item.tagId)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-2xs rounded-md border border-bad/40 text-bad hover:bg-bad/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={10} />
                    {deleting.has(item.tagId) ? t("deleting") : t("deleteDeadTag")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ── Duplicates Panel ──────────────────────────────────────────────────────────

function DuplicatesPanel() {
  const t = useTranslations("governance");

  const [items, setItems]         = useState<DuplicatePair[]>([]);
  const [loading, setLoading]     = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merging, setMerging]     = useState<Set<string>>(new Set());

  const pairKey = (p: DuplicatePair) => `${p.sourceId}-${p.targetId}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDuplicateSuggestions({ limit: 50 });
      setItems(res.items);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDismiss = (pair: DuplicatePair) => {
    setDismissed(prev => new Set(prev).add(pairKey(pair)));
  };

  const handleMerge = async (pair: DuplicatePair) => {
    const key = pairKey(pair);
    if (!confirm(t("mergeTagConfirm", { from: pair.sourceName, to: pair.targetName }))) return;
    setMerging(prev => new Set(prev).add(key));
    try {
      const result = await mergeTags(pair.targetId, [pair.sourceId]);
      toast.success(t("mergeTagSuccessMsg", { count: result.entityTagsMoved }));
      setDismissed(prev => new Set(prev).add(key));
    } catch (err) {
      toast.error(t("mergeTagFailedMsg", { message: (err as Error).message }));
    } finally {
      setMerging(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const reasonLabel = (reason: string) => {
    const map: Record<string, string> = {
      name_similarity: t("reasonNameSimilarity"),
      slug_similarity: t("reasonSlugSimilarity"),
      alias_overlap:   t("reasonAliasOverlap"),
    };
    return map[reason] ?? reason;
  };

  const visible = items.filter(p => !dismissed.has(pairKey(p)));

  return (
    <SectionCard
      title={t("duplicatePanelTitle")}
      subtitle={t("duplicatePanelDesc")}
      extra={
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      }
    >
      {loading && (
        <div className="p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-alt rounded-lg animate-pulse" />
          ))}
        </div>
      )}
      {!loading && visible.length === 0 && (
        <EmptyState msg={t("noDuplicatesMsg")} />
      )}
      {!loading && visible.length > 0 && (
        <div className="divide-y divide-edge">
          {visible.map(pair => {
            const key = pairKey(pair);
            const isMerging = merging.has(key);
            const simPct = Math.round(pair.similarity * 100);
            return (
              <div key={key} className="px-5 py-3.5 flex items-center gap-4 hover:bg-surface-alt/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-ink">{pair.sourceName}</span>
                    <span className="text-ink-faint">⟷</span>
                    <span className="font-medium text-sm text-ink">{pair.targetName}</span>
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-2xs font-medium",
                      simPct >= 90 ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn",
                    )}>
                      {simPct}%
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-2xs bg-surface-alt border border-edge text-ink-faint">
                      {reasonLabel(pair.reason)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-ink-faint">
                    <Link
                      href={`/groups/${pair.groupId}`}
                      className="hover:text-ink transition-colors flex items-center gap-1"
                    >
                      {pair.groupName}
                      <ExternalLink size={9} className="opacity-50" />
                    </Link>
                    {pair.sharedEntityCount > 0 && (
                      <span>{t("sharedEntities", { count: pair.sharedEntityCount })}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleDismiss(pair)}
                    className="px-2.5 py-1 text-xs border border-edge rounded-md text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
                  >
                    {t("dismiss")}
                  </button>
                  <button
                    onClick={() => handleMerge(pair)}
                    disabled={isMerging}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-brand/40 rounded-md text-brand hover:bg-brand/10 transition-colors disabled:opacity-40"
                  >
                    <Merge size={11} />
                    {isMerging ? t("merging") : t("mergeIntoTarget", { name: pair.targetName })}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ── Summary Banner ────────────────────────────────────────────────────────────

function SummaryBanner() {
  const t = useTranslations("governance");
  const [deadCount, setDeadCount] = useState<number | null>(null);
  const [dupCount, setDupCount]   = useState<number | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      getDeadTags({ period: "90d", limit: 500 }).then(r => setDeadCount(r.items.length)),
      getDuplicateSuggestions({ limit: 100 }).then(r => setDupCount(r.items.length)),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-20 rounded-xl bg-surface-alt/60 card-border animate-pulse mb-7" />;
  }

  const isHealthy = (deadCount ?? 0) === 0 && (dupCount ?? 0) === 0;

  return (
    <div className={cn(
      "rounded-xl card-border px-6 py-4 mb-7 flex items-center gap-5",
      isHealthy ? "bg-ok/5 border-ok/20" : "bg-warn/5 border-warn/20",
    )}>
      {isHealthy
        ? <CheckCircle2 size={20} className="text-ok shrink-0" />
        : <AlertTriangle size={20} className="text-warn shrink-0" />
      }
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">
          {isHealthy ? t("healthyTitle") : t("issuesTitle")}
        </p>
        <p className="text-xs text-ink-faint mt-0.5">
          {isHealthy
            ? t("healthyDesc")
            : [
                deadCount ? t("deadTagsSummary", { count: deadCount }) : null,
                dupCount  ? t("dupPairsSummary", { count: dupCount }) : null,
              ].filter(Boolean).join(" · ")
          }
        </p>
      </div>
      {!isHealthy && (
        <div className="flex items-center gap-4 text-xs text-ink-faint">
          {deadCount !== null && deadCount > 0 && (
            <span className="flex items-center gap-1">
              <Trash2 size={12} />
              {t("deadTagsBadge", { count: deadCount })}
            </span>
          )}
          {dupCount !== null && dupCount > 0 && (
            <span className="flex items-center gap-1">
              <Merge size={12} />
              {t("dupPairsBadge", { count: dupCount })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  const t = useTranslations("governance");
  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="mt-7 space-y-6">
        <SummaryBanner />
        <UsagePanel />
        <DeadTagsPanel />
        <DuplicatesPanel />
      </div>
    </div>
  );
}
