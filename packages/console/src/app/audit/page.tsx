"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Trash2, RefreshCw, ClipboardCheck } from "lucide-react";
import {
  getAuditItems, updateEntityTagStatus, removeEntityTag, getEntityTypes,
  type AuditItem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 30;

type StatusFilter = "pending" | "active" | "rejected";

const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  pending:  { label: "待审核", dot: "bg-warn",     text: "text-warn" },
  active:   { label: "已激活", dot: "bg-ok",       text: "text-ok" },
  rejected: { label: "已拒绝", dot: "bg-bad/70",   text: "text-bad" },
};

const SOURCE_LABEL: Record<string, string> = {
  ai:     "AI 打标",
  manual: "手动",
  system: "系统",
  import: "导入",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmItem, setConfirmItem] = useState<AuditItem | null>(null);

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(t => t.entityType)))
      .catch(() => {});
  }, []);

  const load = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError("");
    setSelected(new Set());
    try {
      const data = await getAuditItems({
        status: statusFilter,
        entityType: entityTypeFilter || undefined,
        page: pageNum,
        pageSize: PAGE_SIZE,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setError("加载失败，请检查 Taxcon 服务是否正常运行");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, entityTypeFilter]);

  useEffect(() => {
    setPage(1);
    load(1);
  }, [load]);

  const itemKey = (item: AuditItem) => `${item.tagId}:${item.entityType}:${item.entityId}`;

  const setProcessingKey = (key: string, active: boolean) => {
    setProcessing(prev => {
      const next = new Set(prev);
      if (active) next.add(key); else next.delete(key);
      return next;
    });
  };

  const removeItem = (key: string) => {
    setItems(prev => prev.filter(i => itemKey(i) !== key));
    setTotal(prev => prev - 1);
    setSelected(prev => { const n = new Set(prev); n.delete(key); return n; });
  };

  const handleStatusChange = async (item: AuditItem, newStatus: "active" | "rejected") => {
    const key = itemKey(item);
    setProcessingKey(key, true);
    try {
      await updateEntityTagStatus(item.entityType, item.entityId, item.tagId, newStatus);
      removeItem(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setProcessingKey(key, false);
    }
  };

  const handleRemove = async (item: AuditItem) => {
    setConfirmItem(null);
    const key = itemKey(item);
    setProcessingKey(key, true);
    try {
      await removeEntityTag(item.entityType, item.entityId, item.tagId);
      removeItem(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setProcessingKey(key, false);
    }
  };

  const selectedItems = items.filter(i => selected.has(itemKey(i)));

  const handleBulkStatus = async (newStatus: "active" | "rejected") => {
    if (selectedItems.length === 0) return;
    setError("");
    const results = await Promise.allSettled(
      selectedItems.map(item =>
        updateEntityTagStatus(item.entityType, item.entityId, item.tagId, newStatus)
          .then(() => itemKey(item))
      )
    );
    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map(r => r.value);
    succeeded.forEach(key => removeItem(key));
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed > 0) setError(`${failed} 条操作失败`);
  };

  const allKeys = items.map(itemKey);
  const allSelected = allKeys.length > 0 && allKeys.every(k => selected.has(k));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allKeys));
  const toggleOne = (key: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="审核队列"
        description="审核 AI 自动打标或其他待确认的实体标签关联"
        action={
          <Button variant="outline" size="sm" onClick={() => load(page)}>
            <RefreshCw size={13} />
            刷新
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {/* Segmented status tabs */}
        <div className="flex items-center p-0.5 bg-[#111] border border-edge rounded-lg gap-px">
          {(["pending", "active", "rejected"] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
                statusFilter === s
                  ? "bg-[#1E1E1E] text-ink font-medium shadow-sm border border-edge-mid"
                  : "text-ink-dim hover:text-ink"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[s].dot}`} />
              {STATUS_META[s].label}
            </button>
          ))}
        </div>

        <Select
          value={entityTypeFilter}
          onChange={e => setEntityTypeFilter(e.target.value)}
          className="!w-36 !text-xs !py-1.5"
        >
          <option value="">全部实体类型</option>
          {entityTypes.map(et => <option key={et} value={et}>{et}</option>)}
        </Select>

        <span className="ml-auto text-[11px] text-ink-faint tabular-nums">{total} 条记录</span>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#111] border border-edge-mid rounded-lg">
          <span className="text-xs text-ink-dim">
            已选 <span className="text-ink font-medium tabular-nums">{selected.size}</span> 条
          </span>
          <div className="flex gap-2 ml-auto">
            {statusFilter !== "active" && (
              <Button size="sm" variant="ok" onClick={() => handleBulkStatus("active")}>
                <CheckCircle size={12} />
                批量通过
              </Button>
            )}
            {statusFilter !== "rejected" && (
              <Button size="sm" variant="danger" onClick={() => handleBulkStatus("rejected")}>
                <XCircle size={12} />
                批量拒绝
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              取消
            </Button>
          </div>
        </div>
      )}

      <ErrorBanner message={error} />

      {loading ? (
        <div className="card-border overflow-hidden animate-pulse">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-edge last:border-0">
              <div className="w-4 h-4 bg-edge-mid rounded" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 bg-edge-mid rounded" />
                <div className="h-3 w-20 bg-edge rounded" />
              </div>
              <div className="h-3 w-16 bg-edge rounded" />
              <div className="h-3 w-10 bg-edge rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card-border overflow-hidden animate-fade-in">
          <div className="py-28 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#161616] to-[#0A0A0A] border border-edge-mid flex items-center justify-center mb-5 shadow-[0_2px_8px_rgba(0,0,0,.4)]">
              <ClipboardCheck size={22} className="text-ink-faint" strokeWidth={1.5} />
            </div>
            <p className="text-[14px] font-semibold text-ink-sub">
              {statusFilter === "pending" ? "暂无待审核记录" : "暂无记录"}
            </p>
            {statusFilter === "pending" && (
              <p className="text-[12px] text-ink-faint mt-1.5 max-w-[200px] leading-relaxed">
                AI 打标后，新记录会出现在这里
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="card-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-[#0D0D0D]">
                <th className="pl-5 pr-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-ink w-3.5 h-3.5"
                    aria-label="全选"
                  />
                </th>
                {["标签", "实体", "来源", "置信度", "状态", "时间", ""].map((h, i) => (
                  <th key={i} className={`py-3 text-[10px] font-medium text-ink-faint uppercase tracking-[0.08em] ${i === 6 ? "pr-5 text-right" : "px-3 text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {items.map(item => {
                const key = itemKey(item);
                const busy = processing.has(key);
                const isSelected = selected.has(key);
                const statusMeta = STATUS_META[item.status] ?? { label: item.status, dot: "bg-edge-mid", text: "text-ink-dim" };
                return (
                  <tr
                    key={key}
                    className={`group/row transition-colors ${busy ? "opacity-40 pointer-events-none" : ""} ${
                      isSelected ? "bg-[#151515]" : "hover:bg-[#0E0E0E]"
                    }`}
                  >
                    <td className="pl-5 pr-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(key)}
                        className="accent-ink w-3.5 h-3.5"
                        aria-label={`选择 ${item.tag.name}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-[13px] font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>{item.tag.name}</p>
                      <p className="text-[11px] text-ink-sub mt-0.5">{item.tag.group.name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-[11px] font-mono text-ink-dim">{item.entityType}</p>
                      <p className="text-[10px] font-mono text-ink-sub mt-0.5 max-w-[120px] truncate">{item.entityId}</p>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-ink-dim">
                      {SOURCE_LABEL[item.source] ?? item.source}
                    </td>
                    <td className="px-3 py-3">
                      {item.confidence != null ? (
                        <span className={`text-[12px] font-medium tabular-nums ${
                          item.confidence >= 0.8 ? "text-ok" :
                          item.confidence >= 0.5 ? "text-warn" : "text-bad"
                        }`}>
                          {Math.round(item.confidence * 100)}%
                        </span>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${statusMeta.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusMeta.dot}`} />
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-ink-sub tabular-nums">
                      {formatTime(item.taggedAt)}
                    </td>
                    <td className="pr-4 py-3">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                        {item.status !== "active" && (
                          <button
                            disabled={busy}
                            onClick={() => handleStatusChange(item, "active")}
                            className="p-1.5 rounded-md text-ink-faint hover:text-ok hover:bg-ok/10 transition-all disabled:opacity-40"
                            title="通过"
                          >
                            <CheckCircle size={14} />
                          </button>
                        )}
                        {item.status !== "rejected" && (
                          <button
                            disabled={busy}
                            onClick={() => handleStatusChange(item, "rejected")}
                            className="p-1.5 rounded-md text-ink-faint hover:text-warn hover:bg-warn/10 transition-all disabled:opacity-40"
                            title="拒绝"
                          >
                            <XCircle size={14} />
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => setConfirmItem(item)}
                          className="p-1.5 rounded-md text-ink-faint hover:text-bad hover:bg-bad/10 transition-all disabled:opacity-40"
                          title="删除关联"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={newPage => { setPage(newPage); load(newPage); }}
          />
        </div>
      )}

      {confirmItem && (
        <ConfirmDialog
          open
          title="删除标签关联"
          description={`标签：${confirmItem.tag.name}（${confirmItem.tag.group.name}）\n实体：${confirmItem.entityType} / ${confirmItem.entityId}`}
          confirmLabel="删除"
          danger
          onConfirm={() => handleRemove(confirmItem)}
          onCancel={() => setConfirmItem(null)}
        />
      )}
    </div>
  );
}
