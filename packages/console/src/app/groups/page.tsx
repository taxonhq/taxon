"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, Trash2, Settings2, ChevronRight, Layers } from "lucide-react";
import {
  getTagGroups, getGroupTags, createTagGroup, deleteTagGroup,
  createTag, deleteTag, getEntityTypes,
  type TagGroup, type Tag,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const GROUP_PAGE_SIZE = 20;
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
  const [groups, setGroups] = useState<GroupWithTags[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [groupForm, setGroupForm] = useState({
    slug: "", name: "", description: "", entityScope: "", allowMultiple: "true",
  });
  const [confirm, setConfirm] = useState<PendingDelete | null>(null);

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(t => t.entityType)))
      .catch(() => {});
  }, []);

  const setGF = (k: string, v: string) => setGroupForm(f => ({ ...f, [k]: v }));

  const load = async (pageNum = page) => {
    setError("");
    try {
      const { items: rawGroups, total: groupTotal } = await getTagGroups({ page: pageNum, pageSize: GROUP_PAGE_SIZE });
      setTotal(groupTotal);
      setGroups(rawGroups.map(g => ({ ...g, previewTags: [], tagTotal: g._count?.tags ?? 0 })));
      setLoading(false);
      rawGroups.forEach(async g => {
        try {
          const { items, total: tagTotal } = await getGroupTags(g.id, { page: 1, pageSize: TAG_PREVIEW_SIZE });
          setGroups(prev => prev.map(pg => pg.id === g.id ? { ...pg, previewTags: items, tagTotal } : pg));
        } catch { /* per-group failure is non-fatal */ }
      });
    } catch {
      setError("加载失败，请检查 Taxcon 服务是否正常运行");
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = (newPage: number) => { setPage(newPage); setLoading(true); load(newPage); };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.slug.trim() || !groupForm.name.trim()) { setError("slug 和名称为必填"); return; }
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
      setError(err instanceof Error ? err.message : "创建失败");
    } finally { setSavingGroup(false); }
  };

  const handleDeleteGroup = (group: GroupWithTags) => setConfirm({ type: "group", group });

  const executeDeleteGroup = async (group: GroupWithTags, force: boolean) => {
    setConfirm(null); setError("");
    try {
      await deleteTagGroup(group.id, force);
      setGroups(prev => prev.filter(g => g.id !== group.id));
      setTotal(prev => prev - 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && msg.includes("实体关联")) setConfirm({ type: "group", group, force: true, message: msg });
      else setError(msg || "删除失败");
    }
  };

  const handleDeleteTag = (groupId: string, tag: Tag) =>
    setConfirm({ type: "tag", group: groups.find(g => g.id === groupId)!, tag });

  const executeDeleteTag = async (group: GroupWithTags, tag: Tag, force: boolean) => {
    setConfirm(null); setError("");
    try {
      await deleteTag(tag.id, force);
      setGroups(prev => prev.map(g =>
        g.id === group.id
          ? { ...g, previewTags: g.previewTags.filter(t => t.id !== tag.id), tagTotal: g.tagTotal - 1 }
          : g
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && msg.includes("个实体使用")) {
        setConfirm({ type: "tag", group, tag, force: true, message: msg.replace("，如需强制删除请添加 ?force=true", "") });
      } else setError(msg || "删除标签失败");
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
    } catch (err) { setError(err instanceof Error ? err.message : "创建标签失败"); }
  };

  const dialogProps = (() => {
    if (!confirm) return null;
    if (confirm.type === "group") return confirm.force
      ? { title: "强制删除分组", description: `${confirm.message}\n\n确认强制删除？该分组下所有标签及实体关联将一并移除，操作不可逆。`, confirmLabel: "强制删除" }
      : { title: `删除分组「${confirm.group.name}」`, description: "该分组下所有标签和关联将一并删除，操作不可逆。", confirmLabel: "删除" };
    return confirm.force
      ? { title: "强制删除标签", description: `${confirm.message}\n\n确认强制删除？关联关系将一并移除，操作不可逆。`, confirmLabel: "强制删除" }
      : { title: `删除标签「${confirm.tag?.name}」`, description: undefined, confirmLabel: "删除" };
  })();

  return (
    <div className="space-y-7">
      <PageHeader
        title="分组管理"
        description="管理标签分组与标签值，点击分组名进入高级配置"
        action={
          <Button onClick={() => setShowGroupForm(v => !v)} size="sm">
            <Plus size={13} />
            新建分组
          </Button>
        }
      />

      <ErrorBanner message={error} />

      {/* Create form */}
      {showGroupForm && (
        <Card className="space-y-5 animate-slide-up">
          <div>
            <p className="text-[15px] font-semibold text-ink">新建标签分组</p>
            <p className="text-[12px] text-ink-dim mt-0.5">分组用于对标签进行维度分类，如「菜系」「口味」「烹饪工艺」</p>
          </div>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Slug（机器标识）" required hint="小写字母、数字、连字符或下划线">
                <Input value={groupForm.slug} onChange={e => setGF("slug", e.target.value)} placeholder="如 cuisine" />
              </Field>
              <Field label="显示名称" required>
                <Input value={groupForm.name} onChange={e => setGF("name", e.target.value)} placeholder="如 菜系" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="适用实体范围" hint="留空则适用所有实体">
                <Select value={groupForm.entityScope} onChange={e => setGF("entityScope", e.target.value)}>
                  <option value="">通用（所有实体）</option>
                  {entityTypes.map(et => <option key={et} value={et}>{et}</option>)}
                </Select>
              </Field>
              <Field label="默认允许多选">
                <Select value={groupForm.allowMultiple} onChange={e => setGF("allowMultiple", e.target.value)}>
                  <option value="true">是（默认）</option>
                  <option value="false">否（单选）</option>
                </Select>
              </Field>
            </div>
            <Field label="描述（可选）">
              <Textarea value={groupForm.description} onChange={e => setGF("description", e.target.value)} rows={2} />
            </Field>
            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowGroupForm(false)}>取消</Button>
              <Button type="submit" size="sm" loading={savingGroup}>创建分组</Button>
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
              <div key={group.id} className="animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
                <GroupCard
                  group={group}
                  onDelete={() => handleDeleteGroup(group)}
                  onDeleteTag={tag => handleDeleteTag(group.id, tag)}
                  onAddTag={name => handleAddTag(group.id, name)}
                />
              </div>
            ))}
          </div>
          <Pagination page={page} pageSize={GROUP_PAGE_SIZE} total={total} onChange={handlePageChange} />
        </>
      )}

      {confirm && dialogProps && (
        <ConfirmDialog
          open title={dialogProps.title} description={dialogProps.description}
          confirmLabel={dialogProps.confirmLabel} danger
          onConfirm={handleConfirm} onCancel={() => setConfirm(null)}
        />
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
  return (
    <div className="card-border overflow-hidden group/card">
      {/* ── Header ── */}
      <div className="flex items-start gap-4 px-5 pt-4 pb-4">

        {/* Name + meta */}
        <div className="flex-1 min-w-0 space-y-2">
          <Link
            href={`/groups/${group.id}`}
            className="block text-[14px] font-semibold text-ink hover:text-ink-dim transition-colors truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {group.name}
          </Link>

          <div className="flex items-center gap-2 flex-wrap">
            {/* slug */}
            <code className="text-[11px] font-mono text-ink-sub bg-[#1A1A1A] border border-edge-mid px-1.5 py-0.5 rounded">
              {group.slug}
            </code>
            {/* entity scope */}
            {group.entityScopes.map(s => (
              <span key={s} className="inline-flex items-center gap-1 text-[11px] text-ink-sub border border-edge-mid px-1.5 py-0.5 rounded">
                <span className="w-1 h-1 rounded-full bg-ink-sub/60 inline-block" />
                {s}
              </span>
            ))}
            {/* cardinality badge */}
            {!group.allowMultiple && (
              <span className="text-[11px] text-warn border border-warn/20 bg-warn/5 px-1.5 py-0.5 rounded">
                单选
              </span>
            )}
            {/* rule count */}
            {group.entityRules.length > 0 && (
              <span className="text-[11px] text-ink-faint">
                {group.entityRules.length} 条规则
              </span>
            )}
          </div>
        </div>

        {/* Tag count — numeric anchor */}
        <div className="shrink-0 text-right leading-none pt-0.5 min-w-[44px]">
          <p className="text-[24px] font-bold text-ink tabular-nums" style={{ letterSpacing: "-0.04em" }}>
            {group.tagTotal}
          </p>
          <p className="text-[9px] text-ink-faint uppercase mt-2" style={{ letterSpacing: "0.18em" }}>标签</p>
        </div>

        {/* Actions — appear on hover */}
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity pt-0.5">
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-ink-faint hover:text-bad hover:bg-bad/10 transition-all"
            title="删除分组"
          >
            <Trash2 size={13} />
          </button>
          <Link
            href={`/groups/${group.id}`}
            className="flex items-center p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-all"
            title="高级配置"
          >
            <Settings2 size={13} />
            <ChevronRight size={11} />
          </Link>
        </div>
      </div>

      {/* ── Tags strip ── */}
      <div className="px-5 py-3 border-t border-edge bg-[#0A0A0A] flex flex-wrap gap-1.5 items-center">
        {group.previewTags.map(tag => (
          <TagChip key={tag.id} tag={tag} onDelete={() => onDeleteTag(tag)} />
        ))}
        {group.tagTotal > group.previewTags.length && (
          <Link
            href={`/groups/${group.id}`}
            className="inline-flex items-center px-2 py-1 text-[11px] text-ink-faint border border-dashed border-edge-mid rounded-md hover:border-edge-strong hover:text-ink-sub transition-all"
          >
            还有 {group.tagTotal - group.previewTags.length} 个 →
          </Link>
        )}
        <AddTagInput onAdd={onAddTag} />
      </div>
    </div>
  );
}

function TagChip({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-ink-sub border border-edge rounded-md cursor-default select-none transition-all hover:border-edge-mid hover:text-ink"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {tag.name}
      {hov && (
        <button
          onClick={onDelete}
          className="ml-0.5 -mr-0.5 w-3.5 h-3.5 flex items-center justify-center text-ink-faint hover:text-bad transition-colors leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}

function AddTagInput({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const name = value.trim();
    if (!name) { setActive(false); setValue(""); return; }
    setLoading(true);
    await onAdd(name);
    setValue(""); setLoading(false);
    ref.current?.focus();
  };

  if (!active) return (
    <button
      onClick={() => { setActive(true); setTimeout(() => ref.current?.focus(), 0); }}
      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-ink-faint border border-dashed border-edge rounded-md hover:border-edge-mid hover:text-ink-sub transition-all"
    >
      <Plus size={10} />新增标签
    </button>
  );

  return (
    <input
      ref={ref} value={value} disabled={loading}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape") { setActive(false); setValue(""); } }}
      onBlur={submit}
      placeholder="输入名称，回车确认"
      className="inline-flex px-2 py-1 text-[11px] border border-edge-mid bg-[#1A1A1A] text-ink rounded-md focus:outline-none focus:border-edge-strong w-36 disabled:opacity-50"
    />
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
  return (
    <div className="card-border overflow-hidden animate-fade-in">
      <div className="py-28 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#161616] to-[#0A0A0A] border border-edge-mid flex items-center justify-center mb-5 shadow-[0_2px_8px_rgba(0,0,0,.4)]">
          <Layers size={22} className="text-ink-faint" strokeWidth={1.5} />
        </div>
        <p className="text-[14px] font-semibold text-ink-sub">暂无标签分组</p>
        <p className="text-[12px] text-ink-faint mt-1.5 max-w-[200px] leading-relaxed">
          点击右上角「新建分组」开始创建标签维度
        </p>
      </div>
    </div>
  );
}
