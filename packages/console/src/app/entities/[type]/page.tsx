"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Search, X, ExternalLink } from "lucide-react";
import {
  getEntitiesByType, registerEntity, unregisterEntity,
  type RegisteredEntity,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 30;

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function EntityTypePage() {
  const params    = useParams<{ type: string }>();
  const entityType = decodeURIComponent(params.type);

  const [items, setItems]       = useState<RegisteredEntity[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [search, setSearch]     = useState("");
  const [committed, setCommitted] = useState(""); // debounced search value

  const [showForm, setShowForm] = useState(false);
  const [newId, setNewId]       = useState("");
  const [saving, setSaving]     = useState(false);

  const [confirmItem, setConfirmItem] = useState<RegisteredEntity | null>(null);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p = 1, q = committed) => {
    setLoading(true);
    setError("");
    try {
      const data = await getEntitiesByType(entityType, { page: p, pageSize: PAGE_SIZE, search: q || undefined });
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("加载失败，请检查服务是否正常运行");
    } finally {
      setLoading(false);
    }
  }, [entityType, committed]);

  useEffect(() => { load(1, committed); }, [committed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search input → committed
  const handleSearchChange = (v: string) => {
    setSearch(v);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setPage(1);
      setCommitted(v);
    }, 350);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim()) return;
    setSaving(true);
    setError("");
    try {
      await registerEntity(entityType, newId.trim());
      setNewId("");
      setShowForm(false);
      setPage(1);
      setCommitted(search);
      load(1, search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setSaving(false);
    }
  };

  const handleUnregister = async (item: RegisteredEntity) => {
    setConfirmItem(null);
    setError("");
    try {
      await unregisterEntity(item.entityType, item.entityId);
      setItems(prev => prev.filter(e => e.entityId !== item.entityId));
      setTotal(prev => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注销失败");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-6 border-b border-edge animate-fade-in">
        <Link
          href="/entities"
          className="p-2 rounded-lg hover:bg-surface-alt transition-colors text-ink-faint hover:text-ink shrink-0"
        >
          <ArrowLeft size={15} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1
            className="text-[26px] font-extrabold text-ink leading-none font-mono"
            style={{ letterSpacing: "-0.03em" }}
          >
            {entityType}
          </h1>
          <p className="text-[12px] text-ink-sub mt-1.5 tabular-nums">
            共 <span className="text-ink font-medium">{total}</span> 个已注册实体
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus size={13} />
          注册实体
        </Button>
      </div>

      <ErrorBanner message={error} />

      {/* Register inline form */}
      {showForm && (
        <div className="card-border overflow-hidden p-4 animate-slide-up">
          <form onSubmit={handleRegister} className="flex items-end gap-3">
            <Field label="实体 ID" required className="flex-1">
              <Input
                autoFocus
                value={newId}
                onChange={e => setNewId(e.target.value)}
                onKeyDown={e => e.key === "Escape" && setShowForm(false)}
                placeholder="输入业务系统的实体 ID"
                className="font-mono"
              />
            </Field>
            <div className="flex gap-2 pb-[1px]">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
              <Button type="submit" size="sm" loading={saving} disabled={!newId.trim()}>注册</Button>
            </div>
          </form>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="搜索实体 ID…"
            className="w-full pl-8 pr-8 py-2 text-sm bg-[#0A0A0A] border border-edge-mid rounded-lg text-ink placeholder:text-ink-faint focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-white/[.04] hover:border-edge-strong/60 transition-all font-mono"
          />
          {search && (
            <button
              onClick={() => handleSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {committed && (
          <span className="text-[12px] text-ink-sub">
            找到 <span className="text-ink font-medium tabular-nums">{total}</span> 条
          </span>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="card-border overflow-hidden animate-pulse">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-edge last:border-0">
              <div className="flex-1 h-3.5 bg-edge-mid rounded w-48" />
              <div className="h-3 w-28 bg-edge rounded" />
              <div className="h-3 w-16 bg-edge rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card-border overflow-hidden animate-fade-in">
          <div className="py-20 flex flex-col items-center text-center">
            <p className="text-[14px] font-semibold text-ink-sub">
              {committed ? `未找到包含「${committed}」的实体` : "暂无已注册实体"}
            </p>
            {!committed && (
              <p className="text-[12px] text-ink-faint mt-1.5">点击「注册实体」添加第一个实体</p>
            )}
          </div>
        </div>
      ) : (
        <div className="card-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-[#0D0D0D]">
                {["实体 ID", "注册时间", ""].map((h, i) => (
                  <th
                    key={i}
                    className={`py-3 text-[10px] font-medium text-ink-faint uppercase tracking-[0.08em] ${
                      i === 0 ? "pl-5 pr-3 text-left" :
                      i === 2 ? "pr-4 text-right" : "px-3 text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {items.map((item, idx) => (
                <tr
                  key={item.entityId}
                  className="group/row hover:bg-[#0E0E0E] transition-colors animate-fade-in"
                  style={{ animationDelay: `${idx * 20}ms` }}
                >
                  <td className="pl-5 pr-3 py-3">
                    <Link
                      href={`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(item.entityId)}`}
                      className="font-mono text-[13px] text-ink hover:text-ink-dim transition-colors flex items-center gap-1.5 group/link"
                    >
                      <span className="truncate max-w-[340px]">{item.entityId}</span>
                      <ExternalLink size={11} className="text-ink-faint opacity-0 group-hover/link:opacity-100 shrink-0 transition-opacity" />
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-[12px] text-ink-sub tabular-nums whitespace-nowrap">
                    {formatTime(item.registeredAt)}
                  </td>
                  <td className="pr-4 py-3">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                      <Link
                        href={`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(item.entityId)}`}
                        className="px-2 py-1 rounded-md text-[11px] text-ink-faint hover:text-ink hover:bg-surface-alt transition-all"
                      >
                        标签管理
                      </Link>
                      <button
                        onClick={() => setConfirmItem(item)}
                        className="p-1.5 rounded-md text-ink-faint hover:text-bad hover:bg-bad/10 transition-all"
                        title="注销实体"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={p => { setPage(p); load(p, committed); }}
          />
        </div>
      )}

      {confirmItem && (
        <ConfirmDialog
          open
          title={`注销实体「${confirmItem.entityId}」`}
          description={`类型：${confirmItem.entityType}\n\n该实体的所有标签关联将一并删除，操作不可逆。`}
          confirmLabel="注销"
          danger
          onConfirm={() => handleUnregister(confirmItem)}
          onCancel={() => setConfirmItem(null)}
        />
      )}
    </div>
  );
}
