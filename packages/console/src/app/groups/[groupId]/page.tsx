"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Plus, Save, X } from "lucide-react";
import {
  getTagGroup, getTagGroupTree, createTag, updateTag, deleteTag,
  updateTagGroup, setEntityRules, getEntityTypes, getTagGroups,
  mergeTag, moveTagToGroup,
  type TagGroup, type TagTreeNode, type TagGroupEntityRule,
} from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TagTree, type TagTreeCallbacks } from "@/components/ui/tag-tree";

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup]               = useState<TagGroup | null>(null);
  const [tree, setTree]                 = useState<TagTreeNode[]>([]);
  const [allGroups, setAllGroups]       = useState<TagGroup[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [entityTypes, setEntityTypes]   = useState<string[]>([]);

  // group edit
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [savingGroup, setSavingGroup]     = useState(false);
  const [groupForm, setGroupForm]         = useState({
    slug: "", name: "", description: "", entityScope: "", allowMultiple: "true",
  });
  const setGF = (k: string, v: string) => setGroupForm(f => ({ ...f, [k]: v }));

  // entity rules
  const [rules, setRules]         = useState<TagGroupEntityRule[]>([]);
  const [savingRules, setSavingRules] = useState(false);
  const [newRuleType, setNewRuleType] = useState("");

  // tag create/edit form
  const [showForm, setShowForm]   = useState(false);
  const [formParentId, setFormParentId] = useState<string | null>(null); // null = root
  const [saving, setSaving]       = useState(false);
  const [newForm, setNewForm]     = useState({ slug: "", name: "", description: "", parentId: "" });

  // tag inline edit (dialog-style)
  type EditState = { tag: TagTreeNode; name: string; slug: string; parentId: string };
  const [editing, setEditing]     = useState<EditState | null>(null);

  // confirm delete
  type PendingDelete = { tag: TagTreeNode; force?: boolean; message?: string };
  const [confirmDelete, setConfirmDelete] = useState<PendingDelete | null>(null);

  // merge dialog: pick which tag to merge INTO (source = selected node)
  type MergeState = { source: TagTreeNode; targetId: string };
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [merging, setMerging]       = useState(false);

  // move-to-group dialog
  type MoveGroupState = { tag: TagTreeNode; targetGroupId: string };
  const [moveGroupState, setMoveGroupState] = useState<MoveGroupState | null>(null);
  const [movingGroup, setMovingGroup]       = useState(false);

  // ── Load ────────────────────────────────────────────────────────

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(t => t.entityType)))
      .catch(() => {});
    getTagGroups({ pageSize: 100 })
      .then(res => setAllGroups(res.items))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const [groupData, treeData] = await Promise.all([
        getTagGroup(groupId),
        getTagGroupTree(groupId),
      ]);
      setGroup(groupData);
      setTree(treeData);
      setRules(groupData.entityRules ?? []);
      setGroupForm({
        slug: groupData.slug,
        name: groupData.name,
        description: groupData.description ?? "",
        entityScope: groupData.entityScopes?.[0] ?? "",
        allowMultiple: groupData.allowMultiple ? "true" : "false",
      });
    } catch (err) {
      setError(err instanceof Error ? `加载失败：${err.message}` : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // ── Group edit ───────────────────────────────────────────────────

  const handleGroupSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name.trim()) { setError("名称为必填"); return; }
    setSavingGroup(true); setError("");
    try {
      await updateTagGroup(groupId, {
        slug:          groupForm.slug.trim() !== group?.slug ? groupForm.slug.trim() : undefined,
        name:          groupForm.name.trim(),
        description:   groupForm.description.trim() || null,
        entityScopes:  groupForm.entityScope ? [groupForm.entityScope] : [],
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

  // ── Entity rules ─────────────────────────────────────────────────

  const addRule = () => {
    const t = newRuleType.trim();
    if (!t || rules.some(r => r.entityType === t)) return;
    setRules(prev => [...prev, { groupId, entityType: t, allowMultiple: true }]);
    setNewRuleType("");
  };
  const updateRule = (entityType: string, allowMultiple: boolean) =>
    setRules(prev => prev.map(r => r.entityType === entityType ? { ...r, allowMultiple } : r));
  const removeRule = (entityType: string) =>
    setRules(prev => prev.filter(r => r.entityType !== entityType));
  const saveRules = async () => {
    setSavingRules(true); setError("");
    try {
      const updated = await setEntityRules(groupId, rules.map(r => ({
        entityType: r.entityType, allowMultiple: r.allowMultiple,
      })));
      setRules(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存规则失败");
    } finally {
      setSavingRules(false);
    }
  };

  // ── Tag create ───────────────────────────────────────────────────

  const openCreateForm = (parentId: string | null) => {
    setFormParentId(parentId);
    setNewForm({ slug: "", name: "", description: "", parentId: parentId ?? "" });
    setShowForm(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.name.trim()) { setError("名称为必填"); return; }
    setSaving(true); setError("");
    try {
      await createTag({
        groupId,
        name:        newForm.name.trim(),
        ...(newForm.slug.trim() ? { slug: newForm.slug.trim() } : {}),
        description: newForm.description.trim() || undefined,
        ...(formParentId ? { parentId: formParentId } : {}),
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  // ── Tag edit ─────────────────────────────────────────────────────

  const handleEditSave = async () => {
    if (!editing || !editing.name.trim()) return;
    setError("");
    try {
      await updateTag(editing.tag.id, {
        name:     editing.name.trim(),
        ...(editing.slug.trim() && editing.slug !== editing.tag.slug ? { slug: editing.slug.trim() } : {}),
        ...(editing.parentId !== (editing.tag.parentId ?? "")
          ? { parentId: editing.parentId || null }
          : {}),
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    }
  };

  // ── Tag delete ───────────────────────────────────────────────────

  const executeDelete = async (tag: TagTreeNode, force: boolean) => {
    setConfirmDelete(null); setError("");
    try {
      await deleteTag(tag.id, force);
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && msg.includes("个实体使用")) {
        setConfirmDelete({ tag, force: true, message: msg.replace("，如需强制删除请添加 ?force=true", "") });
      } else {
        setError(msg || "删除失败");
      }
    }
  };

  // ── Tag move (DnD) ───────────────────────────────────────────────

  const handleMove = async (tagId: string, newParentId: string | null) => {
    setError("");
    try {
      await updateTag(tagId, { parentId: newParentId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移动失败");
    }
  };

  // ── Merge ────────────────────────────────────────────────────────

  const handleMergeConfirm = async () => {
    if (!mergeState?.targetId) return;
    setMerging(true); setError("");
    try {
      const result = await mergeTag(mergeState.targetId, [mergeState.source.id]);
      setMergeState(null);
      load();
      toast.success(`合并成功：迁移了 ${result.entityTagsMoved} 条实体关联，${result.aliasesMoved} 个别名`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "合并失败");
    } finally {
      setMerging(false);
    }
  };

  // ── Move to group ────────────────────────────────────────────────

  const handleMoveGroupConfirm = async () => {
    if (!moveGroupState?.targetGroupId) return;
    setMovingGroup(true); setError("");
    try {
      const result = await moveTagToGroup(moveGroupState.tag.id, moveGroupState.targetGroupId);
      setMoveGroupState(null);
      load();
      toast.success(`迁移成功：共移动 ${result.tagsMoved} 个标签（含子孙）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "迁移失败");
    } finally {
      setMovingGroup(false);
    }
  };

  // ── Tree callbacks ───────────────────────────────────────────────

  const treeCallbacks: TagTreeCallbacks = {
    onMove:      handleMove,
    onEdit:      (tag) => setEditing({ tag, name: tag.name, slug: tag.slug, parentId: tag.parentId ?? "" }),
    onDelete:    (tag) => setConfirmDelete({ tag }),
    onAdd:       openCreateForm,
    onMerge:     (tag) => setMergeState({ source: tag, targetId: "" }),
    onMoveGroup: (tag) => setMoveGroupState({ tag, targetGroupId: "" }),
  };

  // ── Flatten tree for parent selector ────────────────────────────

  function flattenTree(nodes: TagTreeNode[], acc: TagTreeNode[] = []): TagTreeNode[] {
    for (const n of nodes) { acc.push(n); flattenTree(n.children, acc); }
    return acc;
  }
  const flatTags = flattenTree(tree);

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-3 pb-6 border-b border-edge">
          <div className="w-8 h-8 bg-edge-mid rounded-lg" />
          <div className="space-y-1.5">
            <div className="h-5 w-32 bg-edge-mid rounded" />
            <div className="h-3 w-20 bg-edge rounded" />
          </div>
        </div>
        <div className="card-border overflow-hidden p-6 space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-10 bg-edge rounded-lg" />)}
        </div>
      </div>
    );
  }

  const availableEntityTypes = entityTypes.filter(et => !rules.some(r => r.entityType === et));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/groups", label: "返回分组列表" }}
        title={group?.name ?? "标签分组"}
        size="compact"
        description={
          group?.slug ? (
            <code className="text-xs font-mono text-ink-faint">{group.slug}</code>
          ) : undefined
        }
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowGroupEdit(v => !v)}>
              编辑分组
            </Button>
            <Button size="sm" onClick={() => openCreateForm(null)}>
              <Plus size={13} />
              新增标签
            </Button>
          </>
        }
      />

      <ErrorBanner message={error} />

      {/* Group Edit — Drawer */}
      <Drawer
        open={showGroupEdit}
        onClose={() => setShowGroupEdit(false)}
        title="编辑分组属性"
        size="md"
      >
        <form onSubmit={handleGroupSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="显示名称" required>
              <Input value={groupForm.name} onChange={e => setGF("name", e.target.value)} />
            </Field>
            <Field label="Slug" hint="修改 slug 会影响调用方，请谨慎操作">
              <Input value={groupForm.slug} onChange={e => setGF("slug", e.target.value)} className="font-mono" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="适用实体范围" hint="留空则适用所有实体">
              <Combobox
                value={groupForm.entityScope}
                onChange={v => setGF("entityScope", v)}
                options={entityTypes}
                placeholder="通用（所有实体）"
                emptyLabel="通用（所有实体）"
              />
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
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => setShowGroupEdit(false)}>取消</Button>
            <Button type="submit" loading={savingGroup}>保存</Button>
          </div>
        </form>
      </Drawer>

      {/* Entity Rules */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">实体类型规则</p>
            <p className="text-xs text-ink-faint mt-0.5">为特定实体类型设置 allowMultiple 覆盖值，优先级高于分组默认值</p>
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
                  <th key={i} className={`py-2 th-label ${i === 2 ? "text-right" : "text-left"}`}>{h}</th>
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
                    <button onClick={() => removeRule(rule.entityType)} className="p-1.5 text-bad hover:bg-bad/10 rounded-md transition-colors">
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Combobox
            value={newRuleType}
            onChange={setNewRuleType}
            options={availableEntityTypes}
            placeholder="选择或输入实体类型…"
            className="w-48"
          />
          <Button size="sm" variant="outline" onClick={addRule} disabled={!newRuleType.trim()}>
            <Plus size={13} />
            添加规则
          </Button>
        </div>
      </Card>

      {/* Tag Create — Drawer */}
      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="新建标签"
        description={
          formParentId
            ? `父节点：${flatTags.find(t => t.id === formParentId)?.name ?? formParentId}`
            : "创建为根节点"
        }
        size="md"
      >
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
          <Field label="父节点" hint="留空则创建为根节点">
            <Select
              value={formParentId ?? ""}
              onChange={e => setFormParentId(e.target.value || null)}
            >
              <option value="">根节点</option>
              {flatTags.map(t => (
                <option key={t.id} value={t.id}>
                  {"　".repeat(t.depth)}{t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="描述">
            <Textarea value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} rows={3} />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            <Button type="submit" loading={saving}>保存</Button>
          </div>
        </form>
      </Drawer>

      {/* Tag Edit — Drawer */}
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title="编辑标签"
        size="md"
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="显示名称" required>
                <Input
                  value={editing.name}
                  onChange={e => setEditing(s => s ? { ...s, name: e.target.value } : s)}
                />
              </Field>
              <Field label="Slug">
                <Input
                  value={editing.slug}
                  onChange={e => setEditing(s => s ? { ...s, slug: e.target.value } : s)}
                  className="font-mono"
                />
              </Field>
            </div>
            <Field label="父节点" hint="留空则设为根节点">
              <Select
                value={editing.parentId}
                onChange={e => setEditing(s => s ? { ...s, parentId: e.target.value } : s)}
              >
                <option value="">根节点</option>
                {flatTags
                  .filter(t => t.id !== editing.tag.id)
                  .map(t => (
                    <option key={t.id} value={t.id}>
                      {"　".repeat(t.depth)}{t.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
              <Button onClick={handleEditSave}>保存</Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Confirm Delete */}
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

      {/* Merge Tag — Drawer */}
      <Drawer
        open={!!mergeState}
        onClose={() => setMergeState(null)}
        title="合并标签"
        description={
          mergeState
            ? `将「${mergeState.source.name}」的实体关联和别名合并到目标标签，并软删除源标签。`
            : undefined
        }
        size="sm"
      >
        {mergeState && (
          <div className="space-y-4">
            <Field label="合并到（目标标签）" required>
              <Select
                value={mergeState.targetId}
                onChange={e => setMergeState(s => s ? { ...s, targetId: e.target.value } : s)}
              >
                <option value="">— 选择目标标签 —</option>
                {flatTags
                  .filter(t => t.id !== mergeState.source.id)
                  .map(t => (
                    <option key={t.id} value={t.id}>
                      {"　".repeat(t.depth)}{t.name} ({t.slug})
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setMergeState(null)}>取消</Button>
              <Button
                variant="danger"
                loading={merging}
                disabled={!mergeState.targetId}
                onClick={handleMergeConfirm}
              >
                确认合并
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Move Tag to Group — Drawer */}
      <Drawer
        open={!!moveGroupState}
        onClose={() => setMoveGroupState(null)}
        title="迁移标签到其他分组"
        description={
          moveGroupState
            ? `将「${moveGroupState.tag.name}」及其所有子孙节点移动到目标分组，成为该分组的根节点。`
            : undefined
        }
        size="sm"
      >
        {moveGroupState && (
          <div className="space-y-4">
            <Field label="目标分组" required>
              <Select
                value={moveGroupState.targetGroupId}
                onChange={e => setMoveGroupState(s => s ? { ...s, targetGroupId: e.target.value } : s)}
              >
                <option value="">— 选择目标分组 —</option>
                {allGroups
                  .filter(g => g.id !== groupId)
                  .map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.slug})</option>
                  ))}
              </Select>
            </Field>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setMoveGroupState(null)}>取消</Button>
              <Button
                variant="danger"
                loading={movingGroup}
                disabled={!moveGroupState.targetGroupId}
                onClick={handleMoveGroupConfirm}
              >
                确认迁移
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Tag Tree */}
      <Card className="space-y-1 min-h-32">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-ink">标签层级</p>
          <p className="text-xs text-ink-faint">拖拽节点可调整父子关系</p>
        </div>
        <TagTree nodes={tree} callbacks={treeCallbacks} />
      </Card>
    </div>
  );
}
