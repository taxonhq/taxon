"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Plus, Trash2, Search, X, ExternalLink } from "lucide-react";
import {
  getEntitiesByType, registerEntity, unregisterEntity,
  type RegisteredEntity, type EntityTagItem,
} from "@/lib/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PAGE_SIZE_DEFAULT = 20;

// 根据分组 ID 哈希到固定色相位（globals.css 中 --palette-1..8），
// 通过 color-mix 派生 bg / border / 双层文字，light/dark 主题自动适配。
function tagPaletteStyle(groupId: string): {
  chip:  React.CSSProperties;
  group: React.CSSProperties;
  name:  React.CSSProperties;
} {
  let h = 0;
  for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) & 0xffff;
  const hue = `var(--palette-${(h % 8) + 1})`;
  return {
    chip: {
      background: `color-mix(in srgb, ${hue} 12%, transparent)`,
      borderColor: `color-mix(in srgb, ${hue} 25%, transparent)`,
    },
    // group 二级标签（低饱和、与 ink-faint 接近的派生）
    group: { color: `color-mix(in srgb, ${hue} 55%, var(--text-subtle) 45%)` },
    // tag 名（更接近主色调，但仍混合 ink 保持可读）
    name:  { color: `color-mix(in srgb, ${hue} 70%, var(--text-primary) 30%)` },
  };
}

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
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [search, setSearch]     = useState("");
  const [committed, setCommitted] = useState(""); // debounced search value

  // tags map: entityId → active tags
  const [tagsMap, setTagsMap]         = useState<Record<string, EntityTagItem[]>>({});
  const [tagsLoading, setTagsLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [newId, setNewId]       = useState("");
  const [saving, setSaving]     = useState(false);

  const [confirmItem, setConfirmItem] = useState<RegisteredEntity | null>(null);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (p = 1, q = committed, ps?: number) => {
    setLoading(true);
    setError("");
    try {
      // withTags=true 一次性带回当前页所有实体的 active 标签，避免 N+1
      const data = await getEntitiesByType(entityType, {
        page: p,
        pageSize: ps ?? pageSize,
        search: q || undefined,
        withTags: true,
      });
      const entities = data.items ?? [];
      setItems(entities);
      setTotal(data.total ?? 0);

      const map: Record<string, EntityTagItem[]> = {};
      entities.forEach(e => { map[e.entityId] = e.tags ?? []; });
      setTagsMap(map);
      setTagsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败，请检查服务是否正常运行");
    } finally {
      setLoading(false);
    }
  }, [entityType, committed, pageSize]);

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
      <PageHeader
        back={{ href: "/entities", label: "返回实体类型列表" }}
        title={entityType}
        mono
        size="compact"
        description={
          <span className="tabular-nums">
            共 <span className="text-ink font-medium">{total}</span> 个已注册实体
          </span>
        }
        action={
          <Button size="sm" onClick={() => setShowForm(v => !v)}>
            <Plus size={13} />
            注册实体
          </Button>
        }
      />

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
            className="w-full pl-8 pr-8 py-2 text-sm bg-input border border-edge-mid rounded-lg text-ink placeholder:text-ink-faint focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-white/[.04] hover:border-edge-strong/60 transition-all font-mono"
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
          <span className="text-sm text-ink-sub">
            找到 <span className="text-ink font-medium tabular-nums">{total}</span> 条
          </span>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="card-border overflow-hidden animate-pulse">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-edge last:border-0">
              <div className="h-3.5 bg-edge-mid rounded w-36 shrink-0" />
              <div className="flex-1 flex gap-1.5">
                <div className="h-5 bg-edge rounded-md w-20" />
                <div className="h-5 bg-edge rounded-md w-14" />
                <div className="h-5 bg-edge rounded-md w-16" />
              </div>
              <div className="h-3 w-28 bg-edge rounded shrink-0" />
              <div className="h-3 w-16 bg-edge rounded shrink-0" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card-border overflow-hidden animate-fade-in">
          <div className="py-20 flex flex-col items-center text-center">
            <p className="text-md font-semibold text-ink-sub">
              {committed ? `未找到包含「${committed}」的实体` : "暂无已注册实体"}
            </p>
            {!committed && (
              <p className="text-sm text-ink-faint mt-1.5">点击「注册实体」添加第一个实体</p>
            )}
          </div>
        </div>
      ) : (
        <div className="card-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-row-head">
                <th className="pl-5 pr-3 py-3 text-left th-label w-[220px]">
                  实体 ID
                </th>
                <th className="px-3 py-3 text-left th-label">
                  标签
                </th>
                <th className="px-3 py-3 text-left th-label w-[130px] whitespace-nowrap">
                  注册时间
                </th>
                <th className="pr-4 py-3 text-right th-label w-[90px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {items.map((item, idx) => {
                const itemTags = tagsMap[item.entityId] ?? [];
                const MAX_VISIBLE = 6;
                const visible  = itemTags.slice(0, MAX_VISIBLE);
                const overflow = itemTags.length - MAX_VISIBLE;
                return (
                  <tr
                    key={item.entityId}
                    className="group/row hover:bg-row-hover transition-colors animate-fade-in"
                    style={{ animationDelay: `${idx * 20}ms` }}
                  >
                    {/* Entity ID */}
                    <td className="pl-5 pr-3 py-3.5">
                      <Link
                        href={`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(item.entityId)}`}
                        className="font-mono text-base text-ink hover:text-ink-dim transition-colors flex items-center gap-1.5 group/link"
                      >
                        <span className="truncate max-w-[200px]">{item.entityId}</span>
                        <ExternalLink size={11} className="text-ink-faint opacity-0 group-hover/link:opacity-100 group-focus-within/link:opacity-100 shrink-0 transition-opacity" />
                      </Link>
                    </td>

                    {/* Tags — single row, no wrap */}
                    <td className="px-3 py-3.5">
                      {tagsLoading && !(item.entityId in tagsMap) ? (
                        <div className="flex items-center gap-1.5">
                          {[52, 44, 60].map(w => (
                            <div key={w} className="h-[22px] rounded bg-edge animate-pulse shrink-0" style={{ width: w }} />
                          ))}
                        </div>
                      ) : visible.length > 0 ? (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {visible.map(tag => {
                            const p = tagPaletteStyle(tag.groupId);
                            return (
                              <span
                                key={tag.id}
                                title={`${tag.group.name} · ${tag.name}`}
                                style={p.chip}
                                className="inline-flex items-baseline gap-1 px-2 py-[3px] rounded border text-xs leading-none whitespace-nowrap shrink-0"
                              >
                                <span className="text-2xs" style={p.group}>{tag.group.name}</span>
                                <span className="font-medium" style={p.name}>{tag.name}</span>
                              </span>
                            );
                          })}
                          {overflow > 0 && (
                            <Link
                              href={`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(item.entityId)}`}
                              className="px-1.5 py-[3px] rounded text-xs text-ink-faint hover:text-ink border border-edge hover:border-edge-mid transition-colors leading-none shrink-0 bg-surface-alt"
                            >
                              +{overflow}
                            </Link>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-ink-faint/40">—</span>
                      )}
                    </td>

                    {/* Registration time */}
                    <td className="px-3 py-3.5 text-sm text-ink-sub tabular-nums whitespace-nowrap">
                      {formatTime(item.registeredAt)}
                    </td>

                    {/* Actions */}
                    <td className="pr-4 py-3.5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                        <Link
                          href={`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(item.entityId)}`}
                          className="px-2 py-1 rounded-md text-xs text-ink-faint hover:text-ink hover:bg-surface-alt transition-all"
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
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onChange={p => { setPage(p); load(p, committed); }}
            onPageSizeChange={size => { setPageSize(size); setPage(1); load(1, committed, size); }}
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
