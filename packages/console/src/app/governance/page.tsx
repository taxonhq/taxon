"use client";

/**
 * 标签治理面板 (issue #35)
 *
 * 三个面板：
 *  1. 使用度榜单 — 最活跃 / 最冷门的标签
 *  2. 死标签清理 — 一段时间内无活跃实体的标签
 *  3. 重复标签建议 — 名称 / slug / alias 相似度高的对
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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

// ── 工具 ─────────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "从未使用";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30)  return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

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

// ── 使用度榜单 ────────────────────────────────────────────────────────────────

type UsagePeriod = "7d" | "30d" | "90d" | "all";

function UsagePanel() {
  const [items, setItems]         = useState<TagUsageItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [period, setPeriod]       = useState<UsagePeriod>("30d");
  const [order, setOrder]         = useState<"desc" | "asc">("desc");

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
    { v: "7d",  label: "近 7 天" },
    { v: "30d", label: "近 30 天" },
    { v: "90d", label: "近 90 天" },
    { v: "all", label: "全部时间" },
  ];

  return (
    <SectionCard
      title="使用度榜单"
      subtitle="按有效打标（active EntityTag）次数排列"
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
            title={order === "desc" ? "当前：从多到少" : "当前：从少到多"}
          >
            {order === "desc" ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
            {order === "desc" ? "最多" : "最少"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-40"
            title="刷新"
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
              <th className="px-4 py-2.5 text-left font-medium">标签</th>
              <th className="px-4 py-2.5 text-left font-medium">分组</th>
              <th className="px-4 py-2.5 text-right font-medium">使用次数</th>
              <th className="px-4 py-2.5 text-left font-medium">最后使用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {loading && <LoadingRows cols={5} />}
            {!loading && items.length === 0 && (
              <tr><td colSpan={5}><EmptyState msg="暂无标签数据" /></td></tr>
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

// ── 死标签清理 ────────────────────────────────────────────────────────────────

type DeadPeriod = "30d" | "90d" | "180d" | "1y";

function DeadTagsPanel() {
  const [items, setItems]         = useState<DeadTagItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [period, setPeriod]       = useState<DeadPeriod>("90d");
  const [deleting, setDeleting]   = useState<Set<string>>(new Set());

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
    if (!confirm(`确认删除标签「${item.name}」？此操作会同步软删除关联数据。`)) return;
    setDeleting(prev => new Set(prev).add(item.tagId));
    try {
      await deleteTag(item.tagId);
      toast.success(`已删除「${item.name}」`);
      setItems(prev => prev.filter(i => i.tagId !== item.tagId));
    } catch (err) {
      toast.error(`删除失败：${(err as Error).message}`);
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(item.tagId); return s; });
    }
  };

  const PERIODS: { v: DeadPeriod; label: string }[] = [
    { v: "30d",  label: "30 天未用" },
    { v: "90d",  label: "90 天未用" },
    { v: "180d", label: "180 天未用" },
    { v: "1y",   label: "1 年未用" },
  ];

  return (
    <SectionCard
      title="死标签清理建议"
      subtitle="一段时间内无活跃实体打标的标签"
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
            title="刷新"
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
              <th className="px-4 py-2.5 text-left font-medium">标签</th>
              <th className="px-4 py-2.5 text-left font-medium">分组</th>
              <th className="px-4 py-2.5 text-right font-medium">活跃实体数</th>
              <th className="px-4 py-2.5 text-left font-medium">最后使用</th>
              <th className="px-4 py-2.5 text-left font-medium">层级</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {loading && <LoadingRows cols={6} />}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6}><EmptyState msg={`过去 ${period} 内没有死标签，系统健康 🎉`} /></td></tr>
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
                    <span className="px-1.5 py-0.5 rounded text-2xs bg-surface-alt border border-edge">根节点</span>
                  ) : `L${item.depth}`}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(item)}
                    disabled={deleting.has(item.tagId)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-2xs rounded-md border border-bad/40 text-bad hover:bg-bad/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={10} />
                    {deleting.has(item.tagId) ? "删除中…" : "删除"}
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

// ── 重复标签建议 ──────────────────────────────────────────────────────────────

const REASON_LABEL: Record<string, string> = {
  name_similarity: "名称相似",
  slug_similarity: "Slug 相似",
  alias_overlap:   "Alias 重叠",
};

function DuplicatesPanel() {
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

  // 将 source 合并到 target（target 保留）
  const handleMerge = async (pair: DuplicatePair) => {
    const key = pairKey(pair);
    if (!confirm(`将「${pair.sourceName}」合并到「${pair.targetName}」？\n所有实体标签和 alias 将迁移，源标签将被软删除。`)) return;
    setMerging(prev => new Set(prev).add(key));
    try {
      const result = await mergeTags(pair.targetId, [pair.sourceId]);
      toast.success(`合并成功：迁移 ${result.entityTagsMoved} 个实体标签`);
      setDismissed(prev => new Set(prev).add(key));
    } catch (err) {
      toast.error(`合并失败：${(err as Error).message}`);
    } finally {
      setMerging(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const visible = items.filter(p => !dismissed.has(pairKey(p)));

  return (
    <SectionCard
      title="重复标签建议"
      subtitle="名称 / Slug / Alias 相似度 ≥ 75% 的标签对，建议合并或忽略"
      extra={
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-40"
          title="刷新"
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
        <EmptyState msg="未检测到重复嫌疑标签" />
      )}
      {!loading && visible.length > 0 && (
        <div className="divide-y divide-edge">
          {visible.map(pair => {
            const key = pairKey(pair);
            const isMerging = merging.has(key);
            const simPct = Math.round(pair.similarity * 100);
            return (
              <div key={key} className="px-5 py-3.5 flex items-center gap-4 hover:bg-surface-alt/40 transition-colors">
                {/* 标签对信息 */}
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
                      {REASON_LABEL[pair.reason] ?? pair.reason}
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
                      <span>{pair.sharedEntityCount} 个共同实体</span>
                    )}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleDismiss(pair)}
                    className="px-2.5 py-1 text-xs border border-edge rounded-md text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
                  >
                    忽略
                  </button>
                  <button
                    onClick={() => handleMerge(pair)}
                    disabled={isMerging}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-brand/40 rounded-md text-brand hover:bg-brand/10 transition-colors disabled:opacity-40"
                  >
                    <Merge size={11} />
                    {isMerging ? "合并中…" : `合并到「${pair.targetName}」`}
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

// ── 汇总卡片 ─────────────────────────────────────────────────────────────────

function SummaryBanner() {
  const [deadCount, setDeadCount]   = useState<number | null>(null);
  const [dupCount, setDupCount]     = useState<number | null>(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    Promise.all([
      getDeadTags({ period: "90d", limit: 500 }).then(r => setDeadCount(r.items.length)),
      getDuplicateSuggestions({ limit: 100 }).then(r => setDupCount(r.items.length)),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-20 rounded-xl bg-surface-alt/60 card-border animate-pulse mb-7" />
    );
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
          {isHealthy ? "标签状态健康" : "发现需要处理的标签问题"}
        </p>
        <p className="text-xs text-ink-faint mt-0.5">
          {isHealthy
            ? "近 90 天内所有标签均有活跃使用，无重复嫌疑。"
            : [
                deadCount ? `${deadCount} 个死标签（90 天未用）` : null,
                dupCount  ? `${dupCount} 对重复嫌疑` : null,
              ].filter(Boolean).join(" · ")
          }
        </p>
      </div>
      {!isHealthy && (
        <div className="flex items-center gap-4 text-xs text-ink-faint">
          {deadCount !== null && (
            <span className="flex items-center gap-1">
              <Trash2 size={12} />
              {deadCount} 个死标签
            </span>
          )}
          {dupCount !== null && (
            <span className="flex items-center gap-1">
              <Merge size={12} />
              {dupCount} 对重复
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────────────────

export default function GovernancePage() {
  return (
    <div>
      <PageHeader
        title="标签治理"
        description="标签使用分析、死标签清理、重复检测与合并建议"
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
