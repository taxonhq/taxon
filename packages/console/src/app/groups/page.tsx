"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, Tags, Trash2, Settings2, ChevronRight } from "lucide-react";
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

const GROUP_PAGE_SIZE = 20;
const TAG_PREVIEW_SIZE = 20;

type GroupWithTags = TagGroup & { previewTags: Tag[]; tagTotal: number };

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

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(t => t.entityType)))
      .catch(() => {});
  }, []);

  const setGF = (k: string, v: string) => setGroupForm(f => ({ ...f, [k]: v }));

  const load = async (pageNum = page) => {
    setError("");
    try {
      const { items: rawGroups, total: groupTotal } = await getTagGroups({
        page: pageNum,
        pageSize: GROUP_PAGE_SIZE,
      });
      setTotal(groupTotal);
      setGroups(rawGroups.map(g => ({ ...g, previewTags: [], tagTotal: g._count?.tags ?? 0 })));
      setLoading(false);

      // 并发拉取各分组前20条标签
      rawGroups.forEach(async g => {
        try {
          const { items, total: tagTotal } = await getGroupTags(g.id, { page: 1, pageSize: TAG_PREVIEW_SIZE });
          setGroups(prev =>
            prev.map(pg => pg.id === g.id ? { ...pg, previewTags: items, tagTotal } : pg)
          );
        } catch { /* 单组加载失败不阻断 */ }
      });
    } catch {
      setError("加载失败，请检查 tag-service 是否正常运行");
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setLoading(true);
    load(newPage);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.slug.trim() || !groupForm.name.trim()) {
      setError("slug 和名称为必填");
      return;
    }
    setSavingGroup(true);
    setError("");
    try {
      await createTagGroup({
        slug: groupForm.slug.trim(),
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || undefined,
        entityScopes: groupForm.entityScope ? [groupForm.entityScope] : [],
        allowMultiple: groupForm.allowMultiple === "true",
      });
      setGroupForm({ slug: "", name: "", description: "", entityScope: "", allowMultiple: "true" });
      setShowGroupForm(false);
      setPage(1);
      load(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (group: GroupWithTags) => {
    const label = `「${group.name}」`;
    if (!confirm(`确定删除分组 ${label}？该分组下所有标签和关联将一并删除。`)) return;
    try {
      await deleteTagGroup(group.id);
      setGroups(prev => prev.filter(g => g.id !== group.id));
      setTotal(prev => prev - 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("实体关联")) {
        if (!confirm(`${msg}\n\n确认强制删除？`)) return;
        try {
          await deleteTagGroup(group.id, true);
          setGroups(prev => prev.filter(g => g.id !== group.id));
          setTotal(prev => prev - 1);
        } catch { setError("强制删除失败"); }
      } else {
        setError(msg || "删除失败");
      }
    }
  };

  const handleAddTag = async (groupId: string, name: string) => {
    if (!name.trim()) return;
    try {
      const tag = await createTag({ groupId, name: name.trim() });
      setGroups(prev => prev.map(g => {
        if (g.id !== groupId) return g;
        const previewTags = g.previewTags.length < TAG_PREVIEW_SIZE
          ? [...g.previewTags, tag]
          : g.previewTags;
        return { ...g, previewTags, tagTotal: g.tagTotal + 1 };
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建标签失败");
    }
  };

  const handleDeleteTag = async (groupId: string, tag: Tag) => {
    const doDelete = async (force: boolean) => {
      await deleteTag(tag.id, force);
      setGroups(prev => prev.map(g =>
        g.id === groupId
          ? { ...g, previewTags: g.previewTags.filter(t => t.id !== tag.id), tagTotal: g.tagTotal - 1 }
          : g
      ));
    };
    try {
      await doDelete(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("个实体使用")) {
        const hint = msg.replace("，如需强制删除请添加 ?force=true", "");
        if (!confirm(`${hint}\n\n确认强制删除？关联关系将一并移除，操作不可逆。`)) return;
        try { await doDelete(true); } catch { setError("强制删除失败"); }
      } else {
        setError(msg || "删除标签失败");
      }
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="分组管理"
        description="管理标签分组与标签值，点击分组名可进入高级配置"
        action={
          <Button onClick={() => setShowGroupForm(v => !v)} variant="outline">
            <Plus size={16} />
            新建分组
          </Button>
        }
      />

      <ErrorBanner message={error} />

      {showGroupForm && (
        <Card className="space-y-4">
          <p className="text-sm font-medium text-ink">新建标签分组</p>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Slug（机器标识）" required hint="只能包含小写字母、数字、连字符和下划线">
                <Input
                  value={groupForm.slug}
                  onChange={e => setGF("slug", e.target.value)}
                  placeholder="如 cuisine、taste"
                />
              </Field>
              <Field label="显示名称" required>
                <Input
                  value={groupForm.name}
                  onChange={e => setGF("name", e.target.value)}
                  placeholder="如 菜系、口味"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="适用实体范围" hint="留空则适用所有实体类型">
                <Select value={groupForm.entityScope} onChange={e => setGF("entityScope", e.target.value)}>
                  <option value="">通用（所有实体）</option>
                  {entityTypes.map(et => (
                    <option key={et} value={et}>{et}</option>
                  ))}
                </Select>
              </Field>
              <Field label="默认允许多选">
                <Select value={groupForm.allowMultiple} onChange={e => setGF("allowMultiple", e.target.value)}>
                  <option value="true">是（默认）</option>
                  <option value="false">否（单选）</option>
                </Select>
              </Field>
            </div>
            <Field label="描述">
              <Textarea value={groupForm.description} onChange={e => setGF("description", e.target.value)} rows={2} />
            </Field>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowGroupForm(false)}>取消</Button>
              <Button type="submit" loading={savingGroup}>保存</Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="py-20 text-center text-ink-faint">加载中...</p>
      ) : groups.length === 0 ? (
        <p className="py-20 text-center text-ink-faint">暂无标签分组</p>
      ) : (
        <>
          <div className="space-y-3">
            {groups.map(group => (
              <Card key={group.id} padding={false}>
                {/* 分组标题行 */}
                <div className="flex items-center px-5 py-3.5 gap-3">
                  <Tags size={14} className="text-ink-faint shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/groups/${group.id}`}
                        className="font-medium text-sm text-ink hover:text-ink-dim transition-colors"
                      >
                        {group.name}
                      </Link>
                      <span className="text-xs text-ink-faint font-mono">{group.slug}</span>
                      {group.entityScopes.length > 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-surface-alt text-ink-dim">
                          {group.entityScopes.join(", ")}
                        </span>
                      )}
                      {!group.allowMultiple && (
                        <span className="text-[10px] text-ink-faint">单选</span>
                      )}
                      {group.entityRules.length > 0 && (
                        <span className="text-[10px] text-warn">
                          {group.entityRules.length} 条实体规则
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-ink-faint mt-0.5">{group.tagTotal} 个标签</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      className="p-1.5 rounded-md text-bad hover:bg-bad/10 transition-colors"
                      title="删除分组"
                    >
                      <Trash2 size={13} />
                    </button>
                    <Link
                      href={`/groups/${group.id}`}
                      className="p-1.5 rounded-md text-ink-faint hover:bg-surface-alt transition-colors flex items-center"
                      title="高级配置"
                    >
                      <Settings2 size={13} />
                      <ChevronRight size={11} className="ml-0.5" />
                    </Link>
                  </div>
                </div>

                {/* 标签预览区 */}
                <div className="px-5 pb-4 pt-3 flex flex-wrap gap-2 items-center border-t border-edge">
                  {group.previewTags.map(tag => (
                    <TagChip
                      key={tag.id}
                      tag={tag}
                      onDelete={() => handleDeleteTag(group.id, tag)}
                    />
                  ))}
                  {group.tagTotal > group.previewTags.length && (
                    <Link
                      href={`/groups/${group.id}`}
                      className="inline-flex items-center px-2.5 py-1 text-xs text-ink-faint border border-dashed border-edge hover:border-ink-faint hover:text-ink-dim transition-colors"
                    >
                      还有 {group.tagTotal - group.previewTags.length} 个 →
                    </Link>
                  )}
                  <AddTagInput groupId={group.id} onAdd={name => handleAddTag(group.id, name)} />
                </div>
              </Card>
            ))}
          </div>
          <Pagination page={page} pageSize={GROUP_PAGE_SIZE} total={total} onChange={handlePageChange} />
        </>
      )}
    </div>
  );
}

function TagChip({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className="relative inline-flex items-center gap-1 px-2.5 py-1 text-xs text-ink-dim border border-edge cursor-default select-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {tag.name}
      {hovered && (
        <button
          onClick={onDelete}
          className="ml-0.5 -mr-0.5 w-3.5 h-3.5 flex items-center justify-center text-ink-faint hover:text-bad transition-colors text-[10px] leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}

function AddTagInput({ groupId, onAdd }: { groupId: string; onAdd: (name: string) => Promise<void> }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const name = value.trim();
    if (!name) { setActive(false); setValue(""); return; }
    setLoading(true);
    await onAdd(name);
    setValue("");
    setLoading(false);
    inputRef.current?.focus();
  };

  if (!active) {
    return (
      <button
        onClick={() => { setActive(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-ink-faint border border-dashed border-edge hover:border-ink-faint hover:text-ink-dim transition-colors"
      >
        <Plus size={10} />
        新增标签
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        if (e.key === "Escape") { setActive(false); setValue(""); }
      }}
      onBlur={submit}
      disabled={loading}
      placeholder="输入名称，回车确认"
      className="inline-flex px-2.5 py-1 text-xs border border-ink-faint bg-card text-ink focus:outline-none w-36 disabled:opacity-50"
    />
  );
}
