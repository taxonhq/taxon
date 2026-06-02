"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Settings2, ChevronRight, Layers, RotateCcw, Trash, Box, Lock } from "lucide-react";
import {
  getTagGroups, createTagGroup, deleteTagGroup, restoreTagGroup,
  createTag, deleteTag, getEntityTypes, ApiError,
  type TagGroup, type Tag,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const GROUP_PAGE_SIZE_DEFAULT = 20;
const TAG_PREVIEW_SIZE = 20;

type GroupWithTags = TagGroup & { previewTags: Tag[]; tagTotal: number };

interface PendingDelete {
  type: "group" | "tag";
  group: GroupWithTags;
  tag?: Tag;
  force?: boolean;
  message?: string;
}

export default function GroupsPage() {
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");

  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [groups, setGroups] = useState<GroupWithTags[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(GROUP_PAGE_SIZE_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [groupForm, setGroupForm] = useState({
    slug: "", name: "", description: "", entityScope: "", allowMultiple: "true",
  });
  const [confirm, setConfirm] = useState<PendingDelete | null>(null);

  // Recycle bin state
  const [deletedGroups, setDeletedGroups] = useState<TagGroup[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState("");

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(et => et.entityType)))
      .catch(() => {});
  }, []);

  const setGF = (k: string, v: string) => setGroupForm(f => ({ ...f, [k]: v }));

  const load = async (pageNum = page, ps = pageSize) => {
    setError("");
    try {
      const { items: rawGroups, total: groupTotal } = await getTagGroups({
        page: pageNum, pageSize: ps,
        withPreviewTags: true, previewSize: TAG_PREVIEW_SIZE,
      });
      setTotal(groupTotal);
      setGroups(rawGroups.map(g => ({
        ...g,
        previewTags: g.tags ?? [],
        tagTotal:    g._count?.tags ?? 0,
      })));
    } catch (err) {
      setError(err instanceof Error ? tCommon("loadErrorMsg", { message: err.message }) : tCommon("loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = (newPage: number) => { setPage(newPage); setLoading(true); load(newPage); };
  const handlePageSizeChange = (size: number) => { setPageSize(size); setPage(1); setLoading(true); load(1, size); };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.slug.trim() || !groupForm.name.trim()) { setError(t("slugRequired")); return; }
    setSavingGroup(true); setError("");
    try {
      await createTagGroup({
        slug: groupForm.slug.trim(), name: groupForm.name.trim(),
        description: groupForm.description.trim() || undefined,
        entityScopes: groupForm.entityScope ? [groupForm.entityScope] : [],
        allowMultiple: groupForm.allowMultiple === "true",
      });
      setGroupForm({ slug: "", name: "", description: "", entityScope: "", allowMultiple: "true" });
      setShowGroupForm(false); setPage(1); load(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally { setSavingGroup(false); }
  };

  const handleDeleteGroup = (group: GroupWithTags) => setConfirm({ type: "group", group });

  const loadDeleted = async () => {
    setTrashLoading(true); setTrashError("");
    try {
      const { items } = await getTagGroups({ onlyDeleted: true, pageSize: 100 });
      setDeletedGroups(items);
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("trashLoadError"));
    } finally { setTrashLoading(false); }
  };

  const executeDeleteGroup = async (group: GroupWithTags, force: boolean) => {
    setConfirm(null); setError("");
    try {
      await deleteTagGroup(group.id, { force });
      setGroups(prev => prev.filter(g => g.id !== group.id));
      setTotal(prev => prev - 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && err instanceof ApiError && err.code === 409) {
        setConfirm({ type: "group", group, force: true, message: msg });
      } else setError(msg || t("deleteFailed"));
    }
  };

  const handleRestoreGroup = async (group: TagGroup) => {
    setTrashError("");
    try {
      await restoreTagGroup(group.id);
      setDeletedGroups(prev => prev.filter(g => g.id !== group.id));
      load(1);
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("restoreFailed"));
    }
  };

  const handlePermanentDeleteGroup = async (group: TagGroup) => {
    setTrashError("");
    try {
      await deleteTagGroup(group.id, { permanent: true });
      setDeletedGroups(prev => prev.filter(g => g.id !== group.id));
    } catch (err) {
      setTrashError(err instanceof Error ? err.message : t("permanentDeleteFailed"));
    }
  };

  const handleDeleteTag = (groupId: string, tag: Tag) =>
    setConfirm({ type: "tag", group: groups.find(g => g.id === groupId)!, tag });

  const executeDeleteTag = async (group: GroupWithTags, tag: Tag, force: boolean) => {
    setConfirm(null); setError("");
    try {
      await deleteTag(tag.id, { force });
      setGroups(prev => prev.map(g =>
        g.id === group.id
          ? { ...g, previewTags: g.previewTags.filter(tg => tg.id !== tag.id), tagTotal: g.tagTotal - 1 }
          : g
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && err instanceof ApiError && err.code === 409) {
        setConfirm({ type: "tag", group, tag, force: true, message: msg });
      } else setError(msg || t("deleteTagFailed"));
    }
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    if (confirm.type === "group") await executeDeleteGroup(confirm.group, !!confirm.force);
    else if (confirm.tag) await executeDeleteTag(confirm.group, confirm.tag, !!confirm.force);
  };

  const handleAddTag = async (groupId: string, name: string) => {
    if (!name.trim()) return;
    try {
      const tag = await createTag({ groupId, name: name.trim() });
      setGroups(prev => prev.map(g => {
        if (g.id !== groupId) return g;
        const previewTags = g.previewTags.length < TAG_PREVIEW_SIZE ? [...g.previewTags, tag] : g.previewTags;
        return { ...g, previewTags, tagTotal: g.tagTotal + 1 };
      }));
    } catch (err) { setError(err instanceof Error ? err.message : t("createTagFailed")); }
  };

  const dialogProps = (() => {
    if (!confirm) return null;
    if (confirm.type === "group") return confirm.force
      ? { title: t("forceDeleteGroupTitle"), description: t("forceDeleteGroupDesc", { message: confirm.message ?? "" }), confirmLabel: tCommon("forceDelete") }
      : { title: t("deleteGroupTitle", { name: confirm.group.name }), description: t("deleteGroupDesc"), confirmLabel: tCommon("delete") };
    return confirm.force
      ? { title: t("forceDeleteTagTitle"), description: t("forceDeleteTagDesc", { message: confirm.message ?? "" }), confirmLabel: tCommon("forceDelete") }
      : { title: t("deleteTagTitle", { name: confirm.tag?.name ?? "" }), description: undefined, confirmLabel: tCommon("delete") };
  })();

  return (
    <div className="space-y-7">
      <PageHeader
        title={t("title")}
        hint={t("description")}
        action={
          activeTab === "active" && (
            <Button onClick={() => setShowGroupForm(v => !v)} size="sm">
              <Plus size={13} />
              {t("createGroup")}
            </Button>
          )
        }
      />

      {/* ── Tab switcher ── */}
      <div className="flex items-center gap-1 p-0.5 bg-surface-alt border border-edge rounded-lg w-fit">
        {(["active", "trash"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              if (tab === "trash") loadDeleted();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
              activeTab === tab
                ? "bg-overlay text-ink font-medium shadow-sm border border-edge-mid"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {tab === "trash" && <Trash size={11} />}
            {tab === "active" ? t("activeTab") : t("trashTab")}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {/* ── Recycle bin tab ── */}
      {activeTab === "trash" && (
        <RecycleBinSection
          groups={deletedGroups}
          loading={trashLoading}
          error={trashError}
          onRestore={handleRestoreGroup}
          onPermanentDelete={handlePermanentDeleteGroup}
        />
      )}

      {/* ── Active tab ── */}
      {activeTab === "active" && (
      <>
      {/* Create form */}
      {showGroupForm && (
        <Card className="space-y-5 animate-slide-up">
          <div>
            <p className="text-lg font-semibold text-ink">{t("createGroupTitle")}</p>
            <p className="text-sm text-ink-dim mt-0.5">{t("createGroupDesc")}</p>
          </div>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("slugLabel")} required hint={t("slugHint")}>
                <Input value={groupForm.slug} onChange={e => setGF("slug", e.target.value)} placeholder="e.g. cuisine" />
              </Field>
              <Field label={t("nameLabel")} required>
                <Input value={groupForm.name} onChange={e => setGF("name", e.target.value)} placeholder="e.g. Cuisine" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("entityScopeLabel")} hint={t("entityScopeHint")}>
                <Combobox
                  value={groupForm.entityScope}
                  onChange={v => setGF("entityScope", v)}
                  options={entityTypes}
                  placeholder={t("entityScopePlaceholder")}
                  emptyLabel={t("entityScopePlaceholder")}
                />
              </Field>
              <Field label={t("allowMultipleLabel")}>
                <Select value={groupForm.allowMultiple} onChange={e => setGF("allowMultiple", e.target.value)}>
                  <option value="true">{t("allowMultipleYes")}</option>
                  <option value="false">{t("allowMultipleNo")}</option>
                </Select>
              </Field>
            </div>
            <Field label={tCommon("description")} hint={tCommon("optional")}>
              <Textarea value={groupForm.description} onChange={e => setGF("description", e.target.value)} rows={2} />
            </Field>
            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowGroupForm(false)}>{tCommon("cancel")}</Button>
              <Button type="submit" size="sm" loading={savingGroup}>{tCommon("create")}</Button>
            </div>
          </form>
        </Card>
      )}

      {/* List */}
      {loading ? (
        <SkeletonList />
      ) : groups.length === 0 ? (
        <EmptyGroups />
      ) : (
        <>
          <div className="space-y-3">
            {groups.map((group, i) => (
              <div key={group.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}>
                <GroupCard
                  group={group}
                  onDelete={() => handleDeleteGroup(group)}
                  onDeleteTag={tag => handleDeleteTag(group.id, tag)}
                  onAddTag={name => handleAddTag(group.id, name)}
                />
              </div>
            ))}
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} onChange={handlePageChange} onPageSizeChange={handlePageSizeChange} />
        </>
      )}

      {confirm && dialogProps && (
        <ConfirmDialog
          open title={dialogProps.title} description={dialogProps.description}
          confirmLabel={dialogProps.confirmLabel} danger
          onConfirm={handleConfirm} onCancel={() => setConfirm(null)}
        />
      )}
      </>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function GroupCard({
  group, onDelete, onDeleteTag, onAddTag,
}: {
  group: GroupWithTags;
  onDelete: () => void;
  onDeleteTag: (tag: Tag) => void;
  onAddTag: (name: string) => Promise<void>;
}) {
  const t = useTranslations("groups");

  return (
    <div className="card-border overflow-hidden group/card">
      {/* ── Header ── */}
      <div className="flex items-start gap-4 px-5 pt-4 pb-4">

        {/* Name + meta */}
        <div className="flex-1 min-w-0 space-y-2">
          <Link
            href={`/groups/${group.id}`}
            className="block text-md font-semibold text-ink hover:text-ink-dim transition-colors truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {group.name}
          </Link>

          {/* 元数据按语义分三类，各给可辨样式 + tooltip（#126）：
              ① slug = 机器标识（mono code 片）  ② 适用实体类型（实体图标片）
              ③ 基数规则（彩色约束徽章） */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* ① slug — 标识符 */}
            <code
              title={t("slugLabel")}
              className="text-xs font-mono text-ink-sub bg-overlay border border-edge-mid px-1.5 py-0.5 rounded"
            >
              {group.slug}
            </code>
            {/* ② 适用实体类型 */}
            {group.entityScopes.map(s => (
              <span
                key={s}
                title={t("entityScopeLabel")}
                className="inline-flex items-center gap-1 text-xs text-ink-sub border border-edge-mid px-1.5 py-0.5 rounded"
              >
                <Box size={10} className="text-ink-faint shrink-0" aria-hidden />
                {s}
              </span>
            ))}
            {/* ③ 基数规则 — 单选约束 */}
            {!group.allowMultiple && (
              <span
                title={t("allowMultipleLabel")}
                className="inline-flex items-center gap-1 text-xs text-warn border border-warn/20 bg-warn/5 px-1.5 py-0.5 rounded"
              >
                <Lock size={10} className="shrink-0" aria-hidden />
                {t("singleSelectBadge")}
              </span>
            )}
            {/* rule count */}
            {group.entityRules.length > 0 && (
              <span className="text-xs text-ink-faint">
                {t("rulesCount", { count: group.entityRules.length })}
              </span>
            )}
          </div>
        </div>

        {/* Tag count — numeric anchor */}
        <div className="shrink-0 text-right leading-none pt-0.5 min-w-[44px]">
          <p className="text-display-sm font-bold text-ink tabular-nums" style={{ letterSpacing: "-0.04em" }}>
            {group.tagTotal}
          </p>
          <p className="text-2xs text-ink-faint uppercase mt-2" style={{ letterSpacing: "0.18em" }}>{t("tagsLabel")}</p>
        </div>

        {/* Actions — appear on hover or keyboard focus */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 transition-opacity pt-0.5">
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-ink-faint hover:text-bad hover:bg-bad/10 transition-all"
            aria-label={`delete group ${group.name}`}
            title="delete"
          >
            <Trash2 size={13} />
          </button>
          <Link
            href={`/groups/${group.id}`}
            className="flex items-center p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-all"
            aria-label={`settings for ${group.name}`}
            title="settings"
          >
            <Settings2 size={13} />
            <ChevronRight size={11} />
          </Link>
        </div>
      </div>

      {/* ── Tags strip ── */}
      <div className="px-5 py-3 border-t border-edge bg-input flex flex-wrap gap-1.5 items-center">
        {group.previewTags.map(tag => (
          <TagChip key={tag.id} tag={tag} onDelete={() => onDeleteTag(tag)} />
        ))}
        {group.tagTotal > group.previewTags.length && (
          <Link
            href={`/groups/${group.id}`}
            className="inline-flex items-center px-2 py-1 text-xs text-ink-faint border border-dashed border-edge-mid rounded-md hover:border-edge-strong hover:text-ink-sub transition-all"
          >
            {t("moreTagsLink", { count: group.tagTotal - group.previewTags.length })}
          </Link>
        )}
        <AddTagInput onAdd={onAddTag} />
      </div>
    </div>
  );
}

function TagChip({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  return (
    <span
      className="group/chip inline-flex items-center gap-1 px-2 py-1 text-xs text-ink-sub border border-edge rounded-md cursor-default select-none transition-all hover:border-edge-mid hover:text-ink focus-within:border-edge-mid"
    >
      {tag.name}
      <button
        onClick={onDelete}
        aria-label={`delete tag ${tag.name}`}
        className="ml-0.5 -mr-0.5 w-3.5 h-3.5 flex items-center justify-center text-ink-faint hover:text-bad focus:text-bad transition-colors leading-none opacity-0 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 focus:opacity-100"
      >
        ×
      </button>
    </span>
  );
}

function AddTagInput({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const t = useTranslations("groups");
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const name = value.trim();
    if (!name) { discard(); return; }
    setLoading(true);
    await onAdd(name);
    setValue("");
    setLoading(false);
    ref.current?.focus();
  };

  const discard = () => { setActive(false); setValue(""); };

  if (!active) return (
    <button
      onClick={() => { setActive(true); setTimeout(() => ref.current?.focus(), 0); }}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-ink-faint border border-dashed border-edge rounded-md hover:border-edge-mid hover:text-ink-sub transition-all"
    >
      <Plus size={10} />{t("addTagButton")}
    </button>
  );

  return (
    <div className="inline-flex items-center gap-1">
      <input
        ref={ref} value={value} disabled={loading}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter")  { e.preventDefault(); submit(); }
          if (e.key === "Escape") { e.preventDefault(); discard(); }
        }}
        onBlur={discard}
        placeholder={t("tagInputPlaceholder")}
        className="inline-flex px-2 py-1 text-xs border border-edge-mid bg-overlay text-ink rounded-md focus:outline-none focus:border-edge-strong w-32 disabled:opacity-50"
      />
      <button
        onMouseDown={e => { e.preventDefault(); submit(); }}
        disabled={loading || !value.trim()}
        className="p-1 rounded text-ink-faint hover:text-ok hover:bg-ok/10 disabled:opacity-30 transition-all"
      >
        <Plus size={11} />
      </button>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[80, 60, 90].map((w, i) => (
        <div key={i} className="card-border overflow-hidden animate-pulse">
          <div className="flex items-start gap-4 px-5 py-4">
            <div className="flex-1 space-y-2">
              <div className={`h-5 bg-edge-mid rounded w-${w === 80 ? "32" : w === 60 ? "24" : "40"}`} />
              <div className="flex gap-2">
                <div className="h-4 w-16 bg-edge rounded" />
                <div className="h-4 w-12 bg-edge rounded" />
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="h-6 w-10 bg-edge-mid rounded ml-auto" />
              <div className="h-3 w-8 bg-edge rounded ml-auto" />
            </div>
          </div>
          <div className="px-5 py-3 border-t border-edge flex gap-2">
            {[1,2,3,4].map(j => <div key={j} className="h-6 w-10 bg-edge rounded-md" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyGroups() {
  const t = useTranslations("groups");
  return (
    <div className="card-border overflow-hidden animate-fade-in">
      <div className="py-28 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-surface-alt to-surface border border-edge-mid flex items-center justify-center mb-5 shadow-md">
          <Layers size={22} className="text-ink-faint" strokeWidth={1.5} />
        </div>
        <p className="text-md font-semibold text-ink-sub">{t("noGroups")}</p>
        <p className="text-sm text-ink-faint mt-1.5 max-w-[200px] leading-relaxed">
          {t("noGroupsDesc")}
        </p>
      </div>
    </div>
  );
}

// ── Recycle Bin Section ──────────────────────────────────────────────────────

function RecycleBinSection({
  groups, loading, error, onRestore, onPermanentDelete,
}: {
  groups: TagGroup[];
  loading: boolean;
  error: string;
  onRestore: (g: TagGroup) => void;
  onPermanentDelete: (g: TagGroup) => void;
}) {
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");
  const [confirmPerm, setConfirmPerm] = useState<TagGroup | null>(null);

  if (loading) return (
    <div className="card-border overflow-hidden animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-edge last:border-0">
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-40 bg-edge-mid rounded" />
            <div className="h-3 w-24 bg-edge rounded" />
          </div>
          <div className="flex gap-2">
            <div className="h-7 w-16 bg-edge rounded-lg" />
            <div className="h-7 w-20 bg-edge rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );

  if (error) return <ErrorBanner message={error} />;

  if (groups.length === 0) return (
    <div className="card-border overflow-hidden animate-fade-in">
      <div className="py-20 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-xl bg-surface-alt border border-edge-mid flex items-center justify-center mb-4">
          <Trash size={18} className="text-ink-faint" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-ink-sub">{t("trashEmpty")}</p>
        <p className="text-xs text-ink-faint mt-1">{t("trashEmptyDesc")}</p>
      </div>
    </div>
  );

  return (
    <>
      <div className="card-border overflow-hidden animate-fade-in">
        <div className="px-5 py-3 border-b border-edge bg-surface-alt flex items-center gap-2">
          <Trash size={12} className="text-ink-faint" />
          <span className="text-xs text-ink-sub">{t("trashCount", { count: groups.length })}</span>
          <span className="text-xs text-ink-faint ml-auto">{t("trashRestoreHint")}</span>
        </div>
        {groups.map(group => (
          <div key={group.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-edge last:border-0 hover:bg-row-hover transition-colors">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-sub truncate">{group.name}</p>
              <p className="text-xs text-ink-faint font-mono mt-0.5">{group.slug}</p>
            </div>
            <p className="text-xs text-ink-faint tabular-nums shrink-0">
              {group.deletedAt
                ? new Date(group.deletedAt as unknown as string).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : ""}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onRestore(group)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ok border border-ok/30 bg-ok/5 hover:bg-ok/10 rounded-lg transition-colors"
              >
                <RotateCcw size={11} />
                {tCommon("restore")}
              </button>
              <button
                onClick={() => setConfirmPerm(group)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-bad border border-bad/30 bg-bad/5 hover:bg-bad/10 rounded-lg transition-colors"
              >
                <Trash2 size={11} />
                {tCommon("permanentDelete")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmPerm && (
        <ConfirmDialog
          open
          title={`${tCommon("permanentDelete")} "${confirmPerm.name}"`}
          description={t("permanentDeleteDesc")}
          confirmLabel={tCommon("permanentDelete")}
          danger
          onConfirm={() => { onPermanentDelete(confirmPerm); setConfirmPerm(null); }}
          onCancel={() => setConfirmPerm(null)}
        />
      )}
    </>
  );
}
