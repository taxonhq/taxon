"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, Save } from "lucide-react";
import {
  getTagGroup, getGroupTags, createTag, updateTag, deleteTag,
  updateTagGroup, setEntityRules, getEntityTypes,
  type TagGroup, type Tag, type TagGroupEntityRule,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 30;

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<TagGroup | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  // group edit state
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupForm, setGroupForm] = useState({
    slug: "", name: "", description: "", entityScope: "", allowMultiple: "true",
  });

  // entity rules state
  const [rules, setRules] = useState<TagGroupEntityRule[]>([]);
  const [savingRules, setSavingRules] = useState(false);
  const [newRuleType, setNewRuleType] = useState("");

  // tag create state
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newForm, setNewForm] = useState({ slug: "", name: "", description: "" });

  // tag inline-edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  // confirm dialog state
  type PendingDelete = { tag: Tag; force?: boolean; message?: string };
  const [confirmDelete, setConfirmDelete] = useState<PendingDelete | null>(null);

  const setGF = (k: string, v: string) => setGroupForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(t => t.entityType)))
      .catch(() => {});
  }, []);

  const load = async (pageNum = page) => {
    setError("");
    try {
      const [groupData, tagsData] = await Promise.all([
        getTagGroup(groupId),
        getGroupTags(groupId, { page: pageNum, pageSize: PAGE_SIZE }),
      ]);
      setGroup(groupData);
      setTags(tagsData.items);
      setTotal(tagsData.total);
      setRules(groupData.entityRules ?? []);
      setGroupForm({
        slug: groupData.slug,
        name: groupData.name,
        description: groupData.description ?? "",
        entityScope: groupData.entityScopes?.[0] ?? "",
        allowMultiple: groupData.allowMultiple ? "true" : "false",
      });
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); setPage(1); load(1); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGroupSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name.trim()) { setError("名称为必填"); return; }
    setSavingGroup(true);
    setError("");
    try {
      await updateTagGroup(groupId, {
        slug:         groupForm.slug.trim() !== group?.slug ? groupForm.slug.trim() : undefined,
        name:         groupForm.name.trim(),
        description:  groupForm.description.trim() || null,
        entityScopes: groupForm.entityScope ? [groupForm.entityScope] : [],
        allowMultiple: groupForm.allowMultiple === "true",
      });
      setShowGroupEdit(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingGroup(false);
    }
  };

  // ── Entity Rules ──────────────────────────────────────────────

  const addRule = () => {
    if (!newRuleType || rules.some(r => r.entityType === newRuleType)) return;
    setRules(prev => [...prev, { groupId, entityType: newRuleType, allowMultiple: true }]);
    setNewRuleType("");
  };

  const updateRule = (entityType: string, allowMultiple: boolean) => {
    setRules(prev => prev.map(r => r.entityType === entityType ? { ...r, allowMultiple } : r));
  };

  const removeRule = (entityType: string) => {
    setRules(prev => prev.filter(r => r.entityType !== entityType));
  };

  const saveRules = async () => {
    setSavingRules(true);
    setError("");
    try {
      const updated = await setEntityRules(groupId, rules.map(r => ({
        entityType: r.entityType,
        allowMultiple: r.allowMultiple,
      })));
      setRules(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存规则失败");
    } finally {
      setSavingRules(false);
    }
  };

  // ── Tags ──────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.name.trim()) { setError("名称为必填"); return; }
    setSaving(true);
    setError("");
    try {
      await createTag({
        groupId,
        name: newForm.name.trim(),
        ...(newForm.slug.trim() ? { slug: newForm.slug.trim() } : {}),
        description: newForm.description.trim() || undefined,
      });
      setNewForm({ slug: "", name: "", description: "" });
      setShowForm(false);
      setPage(1);
      load(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (tag: Tag) => {
    if (!editName.trim()) return;
    try {
      await updateTag(tag.id, {
        name: editName.trim(),
        ...(editSlug.trim() && editSlug !== tag.slug ? { slug: editSlug.trim() } : {}),
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    }
  };

  const handleDelete = (tag: Tag) => {
    setConfirmDelete({ tag });
  };

  const executeDelete = async (tag: Tag, force: boolean) => {
    setConfirmDelete(null);
    setError("");
    try {
      await deleteTag(tag.id, force);
      setTags(prev => prev.filter(t => t.id !== tag.id));
      setTotal(prev => prev - 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && msg.includes("个实体使用")) {
        const hint = msg.replace("，如需强制删除请添加 ?force=true", "");
        setConfirmDelete({ tag, force: true, message: hint });
      } else {
        setError(msg || "删除失败");
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-3 pb-6 border-b border-edge">
          <div className="w-8 h-8 bg-edge-mid rounded-lg" />
          <div className="space-y-1.5"><div className="h-5 w-32 bg-edge-mid rounded" /><div className="h-3 w-20 bg-edge rounded" /></div>
        </div>
        <div className="card-border overflow-hidden p-6 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-10 bg-edge rounded-lg" />)}
        </div>
      </div>
    );
  }

  const availableEntityTypes = entityTypes.filter(et => !rules.some(r => r.entityType === et));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-6 border-b border-edge">
        <Link href="/groups" className="p-2 rounded-lg hover:bg-[#1A1A1A] transition-colors text-ink-faint hover:text-ink">
          <ArrowLeft size={15} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-ink leading-tight">{group?.name ?? "标签分组"}</h1>
          <p className="text-[11px] text-ink-faint font-mono mt-0.5">{group?.slug}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowGroupEdit(v => !v)}>
          <Pencil size={13} />
          编辑分组
        </Button>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus size={13} />
          新增标签
        </Button>
      </div>

      <ErrorBanner message={error} />

      {/* Group Edit Form */}
      {showGroupEdit && (
        <Card className="space-y-4">
          <p className="text-sm font-medium text-ink">编辑分组属性</p>
          <form onSubmit={handleGroupSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="显示名称" required>
                <Input value={groupForm.name} onChange={e => setGF("name", e.target.value)} />
              </Field>
              <Field label="Slug" hint="修改 slug 会影响调用方，请谨慎操作">
                <Input
                  value={groupForm.slug}
                  onChange={e => setGF("slug", e.target.value)}
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="适用实体范围">
                <Select value={groupForm.entityScope} onChange={e => setGF("entityScope", e.target.value)}>
                  <option value="">通用（所有实体）</option>
                  {entityTypes.map(et => <option key={et} value={et}>{et}</option>)}
                </Select>
              </Field>
              <Field label="默认允许多选">
                <Select value={groupForm.allowMultiple} onChange={e => setGF("allowMultiple", e.target.value)}>
                  <option value="true">是</option>
                  <option value="false">否（单选）</option>
                </Select>
              </Field>
            </div>
            <Field label="描述">
              <Textarea value={groupForm.description} onChange={e => setGF("description", e.target.value)} rows={2} />
            </Field>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowGroupEdit(false)}>取消</Button>
              <Button type="submit" loading={savingGroup}>保存</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Entity Rules Section */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">实体类型规则</p>
            <p className="text-xs text-ink-faint mt-0.5">
              为特定实体类型设置 allowMultiple 覆盖值，优先级高于分组默认值
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={saveRules} loading={savingRules}>
            <Save size={13} />
            保存规则
          </Button>
        </div>

        {rules.length === 0 ? (
          <p className="text-sm text-ink-faint py-2">暂无实体类型规则，使用分组默认 allowMultiple={String(group?.allowMultiple ?? true)}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge">
                {["实体类型", "允许多选", ""].map((h, i) => (
                  <th key={i} className={`py-2 text-[10px] font-medium text-ink-faint uppercase tracking-[0.08em] ${i === 2 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {rules.map(rule => (
                <tr key={rule.entityType}>
                  <td className="py-2.5 font-mono text-ink">{rule.entityType}</td>
                  <td className="py-2.5">
                    <Select
                      value={rule.allowMultiple ? "true" : "false"}
                      onChange={e => updateRule(rule.entityType, e.target.value === "true")}
                      className="w-28"
                    >
                      <option value="true">是</option>
                      <option value="false">否（单选）</option>
                    </Select>
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => removeRule(rule.entityType)}
                      className="p-1.5 text-bad hover:bg-bad/10 rounded-md transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add Rule */}
        {availableEntityTypes.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Select
              value={newRuleType}
              onChange={e => setNewRuleType(e.target.value)}
              className="w-40"
            >
              <option value="">选择实体类型</option>
              {availableEntityTypes.map(et => <option key={et} value={et}>{et}</option>)}
            </Select>
            <Button size="sm" variant="outline" onClick={addRule} disabled={!newRuleType}>
              <Plus size={13} />
              添加规则
            </Button>
          </div>
        )}
      </Card>

      {/* Tag Create Form */}
      {showForm && (
        <Card className="space-y-4">
          <p className="text-sm font-medium text-ink">新建标签</p>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="显示名称" required>
                <Input
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="如 川菜、麻辣"
                />
              </Field>
              <Field label="Slug" hint="不填则由服务端自动生成">
                <Input
                  value={newForm.slug}
                  onChange={e => setNewForm(f => ({ ...f, slug: e.target.value }))}
                  placeholder="如 sichuan、spicy"
                  className="font-mono"
                />
              </Field>
            </div>
            <Field label="描述">
              <Textarea
                value={newForm.description}
                onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </Field>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>取消</Button>
              <Button type="submit" loading={saving}>保存</Button>
            </div>
          </form>
        </Card>
      )}

      {confirmDelete && (
        <ConfirmDialog
          open
          title={confirmDelete.force ? "强制删除标签" : `删除标签「${confirmDelete.tag.name}」`}
          description={
            confirmDelete.force
              ? `${confirmDelete.message}\n\n确认强制删除？关联关系将一并移除，操作不可逆。`
              : undefined
          }
          confirmLabel={confirmDelete.force ? "强制删除" : "删除"}
          danger
          onConfirm={() => executeDelete(confirmDelete.tag, !!confirmDelete.force)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Tags Table */}
      <Card padding={false}>
        {!tags.length ? (
          <p className="p-10 text-center text-ink-faint">暂无标签</p>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge bg-[#0D0D0D]">
                  {["名称", "Slug", "使用量", ""].map((h, i) => (
                    <th key={i} className={`py-3 text-[10px] font-medium text-ink-faint uppercase tracking-[0.08em] ${i === 3 ? "pr-5 text-right" : "px-5 text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {tags.map(tag => (
                  <tr key={tag.id} className="group/tag hover:bg-[#0E0E0E] transition-colors">
                    <td className="px-5 py-3">
                      {editingId === tag.id ? (
                        <input
                          className="w-full px-2 py-1.5 text-sm border border-edge-mid bg-[#1A1A1A] text-ink rounded-md focus:outline-none focus:border-edge-strong focus:ring-1 focus:ring-edge-strong/20"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === "Enter") handleEditSave(tag);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      ) : (
                        <span className="text-sm font-medium text-ink">{tag.name}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {editingId === tag.id ? (
                        <input
                          className="w-full px-2 py-1.5 text-xs font-mono border border-edge-mid bg-[#1A1A1A] text-ink rounded-md focus:outline-none focus:border-edge-strong"
                          value={editSlug}
                          onChange={e => setEditSlug(e.target.value)}
                          placeholder={tag.slug}
                        />
                      ) : (
                        <span className="text-xs text-ink-faint font-mono">{tag.slug}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-ink-dim">
                      {tag._count?.entityTags ?? 0} 个实体
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {editingId === tag.id ? (
                          <>
                            <button
                              onClick={() => handleEditSave(tag)}
                              className="p-1.5 rounded-md text-ok hover:bg-ok/10 transition-colors"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 rounded-md text-ink-faint hover:bg-surface-alt transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <div className="opacity-0 group-hover/tag:opacity-100 transition-opacity flex items-center gap-1">
                            <button
                              onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditSlug(tag.slug); }}
                              className="p-1.5 rounded-md text-ink-dim hover:bg-surface-alt transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(tag)}
                              className="p-1.5 rounded-md text-bad hover:bg-bad/10 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
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
              onChange={newPage => { setPage(newPage); load(newPage); }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
