"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Trash2, RefreshCw } from "lucide-react";
import {
  getAuditItems, updateEntityTagStatus, removeEntityTag, getEntityTypes,
  type AuditItem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";

const PAGE_SIZE = 30;

type StatusFilter = "pending" | "active" | "rejected";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:  { label: "待审核", color: "text-warn" },
  active:   { label: "已激活", color: "text-ok" },
  rejected: { label: "已拒绝", color: "text-bad" },
};

const SOURCE_LABEL: Record<string, string> = {
  ai:     "AI 打标",
  manual: "手动",
  system: "系统",
  import: "导入",
};

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

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(t => t.entityType)))
      .catch(() => {});
  }, []);

  const load = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError("");
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
      setError("加载失败，请检查 tag-service 是否正常运行");
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

  const handleStatusChange = async (
    item: AuditItem,
    newStatus: "active" | "rejected"
  ) => {
    const key = itemKey(item);
    setProcessingKey(key, true);
    try {
      await updateEntityTagStatus(item.entityType, item.entityId, item.tagId, newStatus);
      setItems(prev => prev.filter(i => itemKey(i) !== key));
      setTotal(prev => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setProcessingKey(key, false);
    }
  };

  const handleRemove = async (item: AuditItem) => {
    if (!confirm(`确认删除此关联？\n标签：${item.tag.name}（${item.tag.group.name}）\n实体：${item.entityType}/${item.entityId}`)) return;
    const key = itemKey(item);
    setProcessingKey(key, true);
    try {
      await removeEntityTag(item.entityType, item.entityId, item.tagId);
      setItems(prev => prev.filter(i => itemKey(i) !== key));
      setTotal(prev => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setProcessingKey(key, false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="审核队列"
        description="审核 AI 自动打标或其他待确认的实体标签关联"
        action={
          <Button variant="outline" onClick={() => load(page)}>
            <RefreshCw size={14} />
            刷新
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {(["pending", "active", "rejected"] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs border transition-colors ${
                statusFilter === s
                  ? "border-ink text-ink font-medium"
                  : "border-edge text-ink-dim hover:border-ink-faint"
              }`}
            >
              {STATUS_LABEL[s].label}
            </button>
          ))}
        </div>
        <Select
          value={entityTypeFilter}
          onChange={e => setEntityTypeFilter(e.target.value)}
          className="w-36 text-xs py-1.5"
        >
          <option value="">全部实体类型</option>
          {entityTypes.map(et => <option key={et} value={et}>{et}</option>)}
        </Select>
        <span className="text-xs text-ink-faint ml-auto">共 {total} 条</span>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <p className="py-20 text-center text-ink-faint">加载中...</p>
      ) : items.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-ink-faint">
            {statusFilter === "pending" ? "暂无待审核记录" : "暂无记录"}
          </p>
          {statusFilter === "pending" && (
            <p className="text-xs text-ink-faint mt-2">当 AI 打标后，新的记录会出现在这里</p>
          )}
        </div>
      ) : (
        <>
          <Card padding={false}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge bg-surface-alt text-xs text-ink-faint uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">标签</th>
                  <th className="px-5 py-3 text-left font-medium">实体</th>
                  <th className="px-5 py-3 text-left font-medium">来源</th>
                  <th className="px-5 py-3 text-left font-medium">置信度</th>
                  <th className="px-5 py-3 text-left font-medium">状态</th>
                  <th className="px-5 py-3 text-left font-medium">时间</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {items.map(item => {
                  const key = itemKey(item);
                  const busy = processing.has(key);
                  const statusMeta = STATUS_LABEL[item.status] ?? { label: item.status, color: "text-ink-dim" };
                  return (
                    <tr key={key} className={`hover:bg-surface-alt/50 transition-colors ${busy ? "opacity-50" : ""}`}>
                      <td className="px-5 py-3">
                        <div>
                          <span className="text-sm font-medium text-ink">{item.tag.name}</span>
                          <p className="text-[10px] text-ink-faint mt-0.5">{item.tag.group.name}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div>
                          <span className="text-xs font-mono text-ink-dim">{item.entityType}</span>
                          <p className="text-[10px] font-mono text-ink-faint mt-0.5 max-w-[120px] truncate">{item.entityId}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-ink-dim">
                        {SOURCE_LABEL[item.source] ?? item.source}
                      </td>
                      <td className="px-5 py-3">
                        {item.confidence != null ? (
                          <span className={`text-xs font-medium ${
                            item.confidence >= 0.8 ? "text-ok" :
                            item.confidence >= 0.5 ? "text-warn" : "text-bad"
                          }`}>
                            {Math.round(item.confidence * 100)}%
                          </span>
                        ) : (
                          <span className="text-xs text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium ${statusMeta.color}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-ink-faint">
                        {new Date(item.taggedAt).toLocaleString("zh-CN", {
                          month: "numeric", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {item.status !== "active" && (
                            <button
                              disabled={busy}
                              onClick={() => handleStatusChange(item, "active")}
                              className="p-1.5 rounded-md text-ok hover:bg-ok/10 transition-colors disabled:opacity-40"
                              title="通过"
                            >
                              <CheckCircle size={15} />
                            </button>
                          )}
                          {item.status !== "rejected" && (
                            <button
                              disabled={busy}
                              onClick={() => handleStatusChange(item, "rejected")}
                              className="p-1.5 rounded-md text-warn hover:bg-warn/10 transition-colors disabled:opacity-40"
                              title="拒绝"
                            >
                              <XCircle size={15} />
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() => handleRemove(item)}
                            className="p-1.5 rounded-md text-bad hover:bg-bad/10 transition-colors disabled:opacity-40"
                            title="删除关联"
                          >
                            <Trash2 size={14} />
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
          </Card>
        </>
      )}
    </div>
  );
}
