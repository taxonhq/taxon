"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2, CheckCircle, XCircle, ChevronDown, X } from "lucide-react";
import {
  getEntityTags, addEntityTag, removeEntityTag, updateEntityTagStatus,
  unregisterEntity, getTagGroups, getGroupTags,
  type EntityTagItem, type TagGroup, type Tag,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Pagination } from "@/components/ui/pagination";

const TAGS_PAGE_SIZE_DEFAULT = 20;

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function EntityDetailPage() {
  const params     = useParams<{ type: string; id: string }>();
  const entityType = decodeURIComponent(params.type);
  const entityId   = decodeURIComponent(params.id);
  const router     = useRouter();
  const t = useTranslations("entities");
  const tCommon = useTranslations("common");

  const [tags, setTags]                 = useState<EntityTagItem[]>([]);
  const [tagPage, setTagPage]           = useState(1);
  const [tagsPageSize, setTagsPageSize] = useState(TAGS_PAGE_SIZE_DEFAULT);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [processing, setProcessing]     = useState<Set<string>>(new Set());

  // Add tag form state
  const [showAddForm, setShowAddForm]       = useState(false);
  const [groups, setGroups]                 = useState<TagGroup[]>([]);
  const [selectedGroup, setSelectedGroup]   = useState<TagGroup | null>(null);
  const [groupTags, setGroupTags]           = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId]   = useState("");
  const [addSource, setAddSource]           = useState("manual");
  const [loadingGroupTags, setLoadingGroupTags] = useState(false);
  const [adding, setAdding]                 = useState(false);

  // Confirm dialogs
  const [confirmRemove, setConfirmRemove]         = useState<EntityTagItem | null>(null);
  const [confirmUnregister, setConfirmUnregister] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setTagPage(1);
    try {
      const data = await getEntityTags(entityType, entityId);
      setTags(data);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("未注册") || err.message.includes("not registered"))) {
        setError(t("entityNotFound"));
      } else {
        setError(err instanceof Error ? tCommon("loadErrorMsg", { message: err.message }) : tCommon("loadError"));
      }
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, t, tCommon]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showAddForm || groups.length > 0) return;
    getTagGroups({ pageSize: 100 })
      .then(d => setGroups(d.items))
      .catch(() => {});
  }, [showAddForm, groups.length]);

  useEffect(() => {
    if (!selectedGroup) { setGroupTags([]); setSelectedTagId(""); return; }
    setLoadingGroupTags(true);
    getGroupTags(selectedGroup.id, { pageSize: 100 })
      .then(d => {
        setGroupTags(d.items);
        setSelectedTagId("");
      })
      .catch(() => {})
      .finally(() => setLoadingGroupTags(false));
  }, [selectedGroup]);

  const setProc = (id: string, active: boolean) =>
    setProcessing(prev => { const n = new Set(prev); if (active) n.add(id); else n.delete(id); return n; });

  const handleStatusChange = async (tag: EntityTagItem, status: "active" | "rejected") => {
    const key = tag.id;
    setProc(key, true);
    try {
      await updateEntityTagStatus(entityType, entityId, tag.id, status);
      setTags(prev => prev.map(tg => tg.id === key ? { ...tg, status } : tg));
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    } finally {
      setProc(key, false);
    }
  };

  const handleRemove = async (tag: EntityTagItem) => {
    setConfirmRemove(null);
    const key = tag.id;
    setProc(key, true);
    try {
      await removeEntityTag(entityType, entityId, tag.id);
      setTags(prev => prev.filter(tg => tg.id !== key));
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    } finally {
      setProc(key, false);
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTagId) return;
    setAdding(true);
    setError("");
    try {
      await addEntityTag(entityType, entityId, selectedTagId, addSource);
      setShowAddForm(false);
      setSelectedGroup(null);
      setSelectedTagId("");
      setAddSource("manual");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleUnregister = async () => {
    setConfirmUnregister(false);
    try {
      await unregisterEntity(entityType, entityId);
      router.push(`/entities/${encodeURIComponent(entityType)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    }
  };

  const compatibleGroups = groups.filter(g =>
    g.entityScopes.length === 0 || g.entityScopes.includes(entityType)
  );

  const taggedIds = new Set(tags.map(tg => tg.id));
  const availableGroupTags = groupTags.filter(tg => !taggedIds.has(tg.id));

  const statusMeta = (status: string) => {
    const map: Record<string, { label: string; dot: string; text: string }> = {
      active:   { label: t("statusActive"),   dot: "bg-ok",     text: "text-ok" },
      pending:  { label: t("statusPending"),  dot: "bg-warn",   text: "text-warn" },
      rejected: { label: t("statusRejected"), dot: "bg-bad/70", text: "text-bad" },
    };
    return map[status] ?? { label: status, dot: "bg-edge-mid", text: "text-ink-dim" };
  };

  const sourceLabel = (source: string) => {
    const map: Record<string, string> = {
      ai: "AI",
      manual: t("sourceManual"),
      system: t("sourceSystem"),
      import: t("sourceImport"),
    };
    return map[source] ?? source;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/entities/${encodeURIComponent(entityType)}`, label: t("backToList") }}
        breadcrumb={[{ label: entityType, mono: true, href: `/entities/${encodeURIComponent(entityType)}` }]}
        title={entityId}
        mono
        size="compact"
        description={
          <span className="text-ink-faint">
            <span className="tabular-nums">{tags.length}</span> {t("entityTags")}
          </span>
        }
        action={
          <Button size="sm" onClick={() => setShowAddForm(v => !v)}>
            <Plus size={13} />
            {t("addTag")}
          </Button>
        }
      />

      <ErrorBanner message={error} />

      {/* Add tag form */}
      {showAddForm && (
        <div className="card-border overflow-hidden p-5 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-ink">{t("addTag")}</p>
            <button onClick={() => setShowAddForm(false)} className="p-1.5 text-ink-faint hover:text-ink transition-colors rounded-lg hover:bg-surface-alt">
              <X size={13} />
            </button>
          </div>
          <form onSubmit={handleAddTag}>
            <div className="grid grid-cols-3 gap-3 items-end">
              {/* Step 1: Select group */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-sub uppercase tracking-[0.08em]">{t("selectGroupLabel")}</label>
                <div className="relative">
                  <select
                    value={selectedGroup?.id ?? ""}
                    onChange={e => {
                      const g = compatibleGroups.find(g => g.id === e.target.value) ?? null;
                      setSelectedGroup(g);
                    }}
                    className="w-full px-3 py-2 text-sm bg-input border border-edge-mid rounded-lg text-ink focus:outline-none focus:border-edge-strong hover:border-edge-strong/60 transition-all appearance-none pr-8 cursor-pointer"
                  >
                    <option value="">{t("selectGroupPlaceholder")}</option>
                    {compatibleGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                </div>
              </div>

              {/* Step 2: Select tag */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-sub uppercase tracking-[0.08em]">
                  {t("selectTagLabel")}
                  {loadingGroupTags && <span className="ml-1.5 text-ink-faint normal-case tracking-normal">{tCommon("loading")}</span>}
                </label>
                <div className="relative">
                  <select
                    value={selectedTagId}
                    onChange={e => setSelectedTagId(e.target.value)}
                    disabled={!selectedGroup || loadingGroupTags}
                    className="w-full px-3 py-2 text-sm bg-input border border-edge-mid rounded-lg text-ink focus:outline-none focus:border-edge-strong hover:border-edge-strong/60 transition-all appearance-none pr-8 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!selectedGroup ? t("selectTagFirst") : availableGroupTags.length === 0 ? t("noAvailableTags") : t("selectTagPlaceholder")}
                    </option>
                    {availableGroupTags.map(tg => (
                      <option key={tg.id} value={tg.id}>{tg.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                </div>
              </div>

              {/* Step 3: Source + Submit */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-sub uppercase tracking-[0.08em]">{tCommon("source")}</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      value={addSource}
                      onChange={e => setAddSource(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-input border border-edge-mid rounded-lg text-ink focus:outline-none focus:border-edge-strong hover:border-edge-strong/60 transition-all appearance-none pr-8 cursor-pointer"
                    >
                      <option value="manual">{t("sourceManual")}</option>
                      <option value="import">{t("sourceImport")}</option>
                      <option value="system">{t("sourceSystem")}</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  </div>
                  <Button type="submit" size="sm" loading={adding} disabled={!selectedTagId}>
                    {tCommon("confirm")}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Tags table */}
      {loading ? (
        <div className="card-border overflow-hidden animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-edge last:border-0">
              <div className="h-3.5 w-28 bg-edge-mid rounded" />
              <div className="h-3 w-20 bg-edge rounded" />
              <div className="h-3 w-12 bg-edge rounded ml-auto" />
            </div>
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="card-border overflow-hidden animate-fade-in">
          <div className="py-20 flex flex-col items-center text-center">
            <p className="text-md font-semibold text-ink-sub">{t("noTags")}</p>
            <p className="text-sm text-ink-faint mt-1.5">{t("noTagsHint")}</p>
          </div>
        </div>
      ) : (() => {
        const pagedTags = tags.slice((tagPage - 1) * tagsPageSize, tagPage * tagsPageSize);
        return (
          <div className="card-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge bg-row-head">
                  {[t("entityTags"), t("selectGroupLabel"), tCommon("status"), tCommon("source"), t("taggedAt"), ""].map((h, i) => (
                    <th
                      key={i}
                      className={`py-3 th-label ${
                        i === 0 ? "pl-5 pr-3 text-left" :
                        i === 5 ? "pr-4 text-right" : "px-3 text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {pagedTags.map((tag, idx) => {
                  const busy = processing.has(tag.id);
                  const meta = statusMeta(tag.status);
                  return (
                    <tr
                      key={`${tag.id}-${idx}`}
                      className={`group/row transition-colors animate-fade-in ${busy ? "opacity-40 pointer-events-none" : "hover:bg-row-hover"}`}
                      style={{ animationDelay: `${Math.min(idx, 9) * 20}ms` }}
                    >
                      <td className="pl-5 pr-3 py-3">
                        <span className="text-base font-semibold text-ink">{tag.name}</span>
                      </td>
                      <td className="px-3 py-3 text-sm text-ink-sub">{tag.group.name}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-ink-dim">
                        {sourceLabel(tag.source)}
                        {tag.confidence != null && (
                          <span className={`ml-1.5 tabular-nums ${
                            tag.confidence >= 0.8 ? "text-ok" :
                            tag.confidence >= 0.5 ? "text-warn" : "text-bad"
                          }`}>
                            {Math.round(tag.confidence * 100)}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-sub tabular-nums whitespace-nowrap">
                        {formatTime(tag.taggedAt)}
                      </td>
                      <td className="pr-4 py-3">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                          {tag.status !== "active" && (
                            <button
                              onClick={() => handleStatusChange(tag, "active")}
                              title={t("approveTag")}
                              className="p-1.5 rounded-md text-ink-faint hover:text-ok hover:bg-ok/10 transition-all"
                            >
                              <CheckCircle size={14} />
                            </button>
                          )}
                          {tag.status !== "rejected" && (
                            <button
                              onClick={() => handleStatusChange(tag, "rejected")}
                              title={t("rejectTag")}
                              className="p-1.5 rounded-md text-ink-faint hover:text-warn hover:bg-warn/10 transition-all"
                            >
                              <XCircle size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmRemove(tag)}
                            title={t("removeTagAction")}
                            className="p-1.5 rounded-md text-ink-faint hover:text-bad hover:bg-bad/10 transition-all"
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
              page={tagPage}
              pageSize={tagsPageSize}
              total={tags.length}
              onChange={setTagPage}
              onPageSizeChange={size => { setTagsPageSize(size); setTagPage(1); }}
            />
          </div>
        );
      })()}

      {/* Danger zone */}
      <div className="pt-4 border-t border-edge">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-medium text-ink-sub">{t("unregisterZoneTitle")}</p>
            <p className="text-sm text-ink-faint mt-0.5">{t("unregisterZoneDesc")}</p>
          </div>
          <Button variant="danger" size="sm" onClick={() => setConfirmUnregister(true)}>
            {t("unregisterAction")}
          </Button>
        </div>
      </div>

      {/* Confirm remove tag */}
      {confirmRemove && (
        <ConfirmDialog
          open
          title={t("removeTagTitle", { name: confirmRemove.name })}
          description={t("removeTagFromGroup", { group: confirmRemove.group.name })}
          confirmLabel={t("removeAction")}
          danger
          onConfirm={() => handleRemove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {/* Confirm unregister */}
      {confirmUnregister && (
        <ConfirmDialog
          open
          title={t("unregisterDialogTitle")}
          description={t("unregisterDialogDesc", { count: tags.length })}
          confirmLabel={t("unregisterAction")}
          danger
          onConfirm={handleUnregister}
          onCancel={() => setConfirmUnregister(false)}
        />
      )}
    </div>
  );
}
