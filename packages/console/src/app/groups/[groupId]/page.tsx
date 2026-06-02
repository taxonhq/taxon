"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Save, X, RotateCcw, Trash2, Trash, Search } from "lucide-react";
import {
  getTagGroup, getTagGroupTree, createTag, updateTag, deleteTag, restoreTag,
  getGroupTags, updateTagGroup, setEntityRules, getEntityTypes, getTagGroups,
  mergeTag, moveTagToGroup, ApiError,
  type TagGroup, type Tag, type TagTreeNode, type TagGroupEntityRule,
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
import { groupColor } from "@/lib/group-color";

export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");

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
  const [rules, setRules]           = useState<TagGroupEntityRule[]>([]);
  const [savingRules, setSavingRules] = useState(false);
  const [newRuleType, setNewRuleType] = useState("");

  // tag create/edit form
  const [showForm, setShowForm]         = useState(false);
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [newForm, setNewForm]           = useState({ slug: "", name: "", description: "", parentId: "" });

  // tag inline edit
  type EditState = { tag: TagTreeNode; name: string; slug: string; parentId: string };
  const [editing, setEditing] = useState<EditState | null>(null);

  // confirm delete
  type PendingDelete = { tag: TagTreeNode; force?: boolean; message?: string };
  const [confirmDelete, setConfirmDelete] = useState<PendingDelete | null>(null);

  // merge dialog
  type MergeState = { source: TagTreeNode; targetId: string };
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [merging, setMerging]       = useState(false);

  // move-to-group dialog
  type MoveGroupState = { tag: TagTreeNode; targetGroupId: string };
  const [moveGroupState, setMoveGroupState] = useState<MoveGroupState | null>(null);
  const [movingGroup, setMovingGroup]       = useState(false);

  // tag search filter
  const [tagSearch, setTagSearch] = useState("");

  // recycle bin (deleted tags)
  const [deletedTags, setDeletedTags]       = useState<Tag[]>([]);
  const [trashLoading, setTrashLoading]     = useState(false);
  const [showTrash, setShowTrash]           = useState(false);
  const [confirmPermTag, setConfirmPermTag] = useState<Tag | null>(null);

  // ── Load ────────────────────────────────────────────────────────

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(et => et.entityType)))
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
        slug:          groupData.slug,
        name:          groupData.name,
        description:   groupData.description ?? "",
        entityScope:   groupData.entityScopes?.[0] ?? "",
        allowMultiple: groupData.allowMultiple ? "true" : "false",
      });
    } catch (err) {
      setError(err instanceof Error ? tCommon("loadErrorMsg", { message: err.message }) : tCommon("loadError"));
    } finally {
      setLoading(false);
    }
  }, [groupId, tCommon]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // ── Group edit ───────────────────────────────────────────────────

  const handleGroupSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name.trim()) { setError(t("slugRequired")); return; }
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
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    } finally {
      setSavingGroup(false);
    }
  };

  // ── Entity rules ─────────────────────────────────────────────────

  const addRule = () => {
    const et = newRuleType.trim();
    if (!et || rules.some(r => r.entityType === et)) return;
    setRules(prev => [...prev, { groupId, entityType: et, allowMultiple: true }]);
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
      toast.success(t("rulesUpdated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rulesUpdateFailed"));
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
    if (!newForm.name.trim()) { setError(t("slugRequired")); return; }
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
      setError(err instanceof Error ? err.message : t("createTagFailed"));
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
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    }
  };

  // ── Tag delete ───────────────────────────────────────────────────

  const executeDelete = async (tag: TagTreeNode, force: boolean) => {
    setConfirmDelete(null); setError("");
    try {
      await deleteTag(tag.id, { force });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!force && err instanceof ApiError && err.code === 409) {
        setConfirmDelete({ tag, force: true, message: msg });
      } else {
        setError(msg || t("deleteTagFailed"));
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
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
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
      toast.success(t("mergeSuccessDetail", { entityTagsMoved: result.entityTagsMoved, aliasesMoved: result.aliasesMoved }));
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
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
      toast.success(t("moveSuccessDetail", { count: result.tagsMoved }));
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    } finally {
      setMovingGroup(false);
    }
  };

  // ── Recycle bin ─────────────────────────────────────────────────

  const loadDeletedTags = async () => {
    setTrashLoading(true);
    try {
      const { items } = await getGroupTags(groupId, { onlyDeleted: true, pageSize: 100 });
      setDeletedTags(items);
    } catch { setDeletedTags([]); }
    finally { setTrashLoading(false); }
  };

  const handleRestoreTag = async (tag: Tag) => {
    setError("");
    try {
      await restoreTag(tag.id);
      setDeletedTags(prev => prev.filter(tg => tg.id !== tag.id));
      load();
      toast.success(t("tagRestored", { name: tag.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("restoreFailed"));
    }
  };

  const handlePermanentDeleteTag = async (tag: Tag) => {
    setConfirmPermTag(null); setError("");
    try {
      await deleteTag(tag.id, { permanent: true });
      setDeletedTags(prev => prev.filter(tg => tg.id !== tag.id));
      toast.success(t("tagPermanentlyDeleted", { name: tag.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("permanentDeleteFailed"));
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

  /** Filter tree nodes recursively — keep a node if it or any descendant matches. */
  function filterTree(nodes: TagTreeNode[], q: string): TagTreeNode[] {
    const result: TagTreeNode[] = [];
    for (const n of nodes) {
      const filteredChildren = filterTree(n.children, q);
      const matches = n.name.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q);
      if (matches || filteredChildren.length > 0) {
        result.push({ ...n, children: filteredChildren.length > 0 ? filteredChildren : n.children });
      }
    }
    return result;
  }

  /** Collect IDs of a node and all its descendants (to exclude from parent picker). */
  function getDescendantIds(node: TagTreeNode): Set<string> {
    const ids = new Set<string>([node.id]);
    for (const child of flattenTree(node.children)) ids.add(child.id);
    return ids;
  }

  const availableEntityTypes = entityTypes.filter(et => !rules.some(r => r.entityType === et));

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

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/groups", label: t("backToList") }}
        title={group?.name ?? t("title")}
        size="compact"
        description={group ? (
          <div className="flex items-center gap-3 flex-wrap mt-1">
            {/* slug */}
            <code className="text-xs font-mono text-ink-faint">{group.slug}</code>
            <span className="text-edge-strong">·</span>
            {/* tag count */}
            <span className="text-xs text-ink-sub">
              {t("tagsCount", { count: flatTags.length })}
            </span>
            <span className="text-edge-strong">·</span>
            {/* cardinality */}
            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
              group.allowMultiple
                ? "bg-brand-1/8 border-brand-1/25 text-brand-1"
                : "bg-surface-alt border-edge-mid text-ink-sub"
            }`}>
              {group.allowMultiple ? t("allowMultipleYesShort") : t("allowMultipleNo")}
            </span>
            {/* entity scopes */}
            {group.entityScopes && group.entityScopes.length > 0
              ? group.entityScopes.map(s => (
                  <span key={s} className="text-xs px-1.5 py-0.5 rounded border bg-surface-alt border-edge-mid text-ink-sub font-mono">{s}</span>
                ))
              : <span className="text-xs text-ink-faint">{t("entityScopePlaceholder")}</span>
            }
          </div>
        ) : undefined}
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowGroupEdit(v => !v)}>
              {t("editGroup")}
            </Button>
            <Button size="sm" onClick={() => openCreateForm(null)}>
              <Plus size={13} />
              {t("addTagButton")}
            </Button>
          </>
        }
      />

      <ErrorBanner message={error} />

      {/* Group Edit — Drawer */}
      <Drawer
        open={showGroupEdit}
        onClose={() => setShowGroupEdit(false)}
        title={t("editGroupTitle")}
        size="md"
      >
        <form onSubmit={handleGroupSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("nameLabel")} required>
              <Input value={groupForm.name} onChange={e => setGF("name", e.target.value)} />
            </Field>
            <Field label="Slug" hint={t("slugChangeWarning")}>
              <Input value={groupForm.slug} onChange={e => setGF("slug", e.target.value)} className="font-mono" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("entityScopeLabel")} hint={t("entityScopeHintShort")}>
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
                <option value="true">{t("allowMultipleYesShort")}</option>
                <option value="false">{t("allowMultipleNo")}</option>
              </Select>
            </Field>
          </div>
          <Field label={tCommon("description")}>
            <Textarea value={groupForm.description} onChange={e => setGF("description", e.target.value)} rows={2} />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => setShowGroupEdit(false)}>{tCommon("cancel")}</Button>
            <Button type="submit" loading={savingGroup}>{tCommon("save")}</Button>
          </div>
        </form>
      </Drawer>

      {/* Entity Rules */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">{t("entityRules")}</p>
            <p className="text-xs text-ink-faint mt-0.5">{t("entityRulesDesc")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={saveRules} loading={savingRules}>
            <Save size={13} />
            {t("saveRules")}
          </Button>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-ink-faint py-2">
            {t("noEntityRulesDefault", { value: String(group?.allowMultiple ?? true) })}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge">
                {[t("entityTypeLabel"), t("allowMultipleColLabel"), ""].map((h, i) => (
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
                      <option value="true">{t("allowMultipleYesShort")}</option>
                      <option value="false">{t("allowMultipleNo")}</option>
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
            placeholder={t("entityTypePlaceholderSearch")}
            className="w-48"
          />
          <Button size="sm" variant="outline" onClick={addRule} disabled={!newRuleType.trim()}>
            <Plus size={13} />
            {t("addEntityRule")}
          </Button>
        </div>
      </Card>

      {/* Tag Create — Drawer */}
      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("createTagTitle")}
        description={
          formParentId
            ? t("parentNodeWithName", { name: flatTags.find(tg => tg.id === formParentId)?.name ?? formParentId })
            : t("createAsRoot")
        }
        size="md"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("nameLabel")} required>
              <Input
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Slug" hint={tCommon("optional")}>
              <Input
                value={newForm.slug}
                onChange={e => setNewForm(f => ({ ...f, slug: e.target.value }))}
                className="font-mono"
              />
            </Field>
          </div>
          <Field label={t("parentNodeLabel")} hint={t("parentNodeHint")}>
            <Select
              value={formParentId ?? ""}
              onChange={e => setFormParentId(e.target.value || null)}
            >
              <option value="">{t("rootNodeOption")}</option>
              {flatTags.map(tg => (
                <option key={tg.id} value={tg.id}>
                  {"　".repeat(tg.depth)}{tg.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tCommon("description")}>
            <Textarea value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} rows={3} />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{tCommon("cancel")}</Button>
            <Button type="submit" loading={saving}>{tCommon("save")}</Button>
          </div>
        </form>
      </Drawer>

      {/* Tag Edit — Drawer */}
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t("editTagTitle")}
        size="md"
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("nameLabel")} required>
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
            <Field label={t("parentNodeLabel")} hint={t("parentNodeHint")}>
              <Select
                value={editing.parentId}
                onChange={e => setEditing(s => s ? { ...s, parentId: e.target.value } : s)}
              >
                <option value="">{t("rootNodeOption")}</option>
                {(() => {
                  const excluded = getDescendantIds(editing.tag);
                  return flatTags
                    .filter(tg => !excluded.has(tg.id))
                    .map(tg => (
                      <option key={tg.id} value={tg.id}>
                        {"　".repeat(tg.depth)}{tg.name}
                      </option>
                    ));
                })()}
              </Select>
            </Field>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>{tCommon("cancel")}</Button>
              <Button onClick={handleEditSave}>{tCommon("save")}</Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          open
          title={confirmDelete.force ? t("forceDeleteTagTitle") : t("deleteTagTitle", { name: confirmDelete.tag.name })}
          description={
            confirmDelete.force
              ? t("forceDeleteTagDesc", { message: confirmDelete.message ?? "" })
              : undefined
          }
          confirmLabel={confirmDelete.force ? tCommon("forceDelete") : tCommon("delete")}
          danger
          onConfirm={() => executeDelete(confirmDelete.tag, !!confirmDelete.force)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Merge Tag — Drawer */}
      <Drawer
        open={!!mergeState}
        onClose={() => setMergeState(null)}
        title={t("mergeTagTitle")}
        description={
          mergeState ? t("mergeTagDesc", { name: mergeState.source.name }) : undefined
        }
        size="sm"
      >
        {mergeState && (
          <div className="space-y-4">
            <Field label={t("mergeTarget")} required>
              <Select
                value={mergeState.targetId}
                onChange={e => setMergeState(s => s ? { ...s, targetId: e.target.value } : s)}
              >
                <option value="">{t("mergeTargetPlaceholder")}</option>
                {flatTags
                  .filter(tg => tg.id !== mergeState.source.id)
                  .map(tg => (
                    <option key={tg.id} value={tg.id}>
                      {"　".repeat(tg.depth)}{tg.name} ({tg.slug})
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setMergeState(null)}>{tCommon("cancel")}</Button>
              <Button
                variant="primary"
                loading={merging}
                disabled={!mergeState.targetId}
                onClick={handleMergeConfirm}
              >
                {t("confirmMerge")}
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Move Tag to Group — Drawer */}
      <Drawer
        open={!!moveGroupState}
        onClose={() => setMoveGroupState(null)}
        title={t("moveGroupTitle")}
        description={
          moveGroupState ? t("moveGroupDesc", { name: moveGroupState.tag.name }) : undefined
        }
        size="sm"
      >
        {moveGroupState && (
          <div className="space-y-4">
            <Field label={t("targetGroupLabel")} required>
              <Select
                value={moveGroupState.targetGroupId}
                onChange={e => setMoveGroupState(s => s ? { ...s, targetGroupId: e.target.value } : s)}
              >
                <option value="">{t("targetGroupPlaceholder")}</option>
                {allGroups
                  .filter(g => g.id !== groupId)
                  .map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.slug})</option>
                  ))}
              </Select>
            </Field>
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setMoveGroupState(null)}>{tCommon("cancel")}</Button>
              <Button
                variant="primary"
                loading={movingGroup}
                disabled={!moveGroupState.targetGroupId}
                onClick={handleMoveGroupConfirm}
              >
                {t("confirmMove")}
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* Tag Tree */}
      <Card className="space-y-1 min-h-32">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-sm font-medium text-ink shrink-0">{t("tagTreeTitle")}</p>
          {flatTags.length > 5 && (
            <div className="relative flex-1 max-w-64">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <input
                type="text"
                value={tagSearch}
                onChange={e => setTagSearch(e.target.value)}
                placeholder={tCommon("search") + "…"}
                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-edge bg-input text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand-1 transition-colors"
              />
              {tagSearch && (
                <button
                  onClick={() => setTagSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-ink-faint shrink-0">{t("tagTreeHint")}</p>
        </div>
        {/* 列说明：进度条 = 使用度，右侧数字 = 使用次数（补 #107 缺失的表头/单位） */}
        {flatTags.length > 0 && (
          <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-edge/40 text-[10px] uppercase tracking-wide text-ink-faint">
            <span className="flex-1">{t("tagsLabel")}</span>
            <span className="w-12 text-right">{t("tagUsageCount")}</span>
          </div>
        )}
        <TagTree
          nodes={tagSearch.trim() ? filterTree(tree, tagSearch.trim().toLowerCase()) : tree}
          callbacks={treeCallbacks}
          accent={group ? groupColor(group.slug) : undefined}
        />
        {tagSearch.trim() && filterTree(tree, tagSearch.trim().toLowerCase()).length === 0 && (
          <p className="text-xs text-ink-faint text-center py-4">{tCommon("noResults")}</p>
        )}
      </Card>

      {/* ── Tag Recycle Bin ── */}
      <div className="card-border overflow-hidden">
        <button
          className="w-full flex items-center gap-2 px-5 py-3 text-xs text-ink-faint hover:bg-row-hover transition-colors"
          onClick={() => {
            const next = !showTrash;
            setShowTrash(next);
            if (next && deletedTags.length === 0) loadDeletedTags();
          }}
        >
          <Trash size={12} />
          <span className="font-medium">{t("trashSection")}</span>
          {deletedTags.length > 0 && (
            <span className="ml-1 text-ink-faint">{t("trashTagCount", { count: deletedTags.length })}</span>
          )}
          <span className="ml-auto text-ink-faint">{showTrash ? "▲" : "▼"}</span>
        </button>

        {showTrash && (
          trashLoading ? (
            <div className="px-5 py-4 text-xs text-ink-faint animate-pulse">{tCommon("loading")}</div>
          ) : deletedTags.length === 0 ? (
            <div className="px-5 py-4 text-xs text-ink-faint border-t border-edge">{t("noDeletedTagsInGroup")}</div>
          ) : (
            <div className="border-t border-edge">
              {deletedTags.map(tag => (
                <div key={tag.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-edge last:border-0 hover:bg-row-hover transition-colors">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-ink-sub">{tag.name}</span>
                    <span className="ml-2 text-xs font-mono text-ink-faint">{tag.slug}</span>
                  </div>
                  <p className="text-xs text-ink-faint tabular-nums shrink-0">
                    {tag.deletedAt
                      ? new Date(tag.deletedAt as unknown as string).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : ""}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleRestoreTag(tag)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-ok border border-ok/30 bg-ok/5 hover:bg-ok/10 rounded-md transition-colors"
                    >
                      <RotateCcw size={10} />{tCommon("restore")}
                    </button>
                    <button
                      onClick={() => setConfirmPermTag(tag)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-bad border border-bad/30 bg-bad/5 hover:bg-bad/10 rounded-md transition-colors"
                    >
                      <Trash2 size={10} />{tCommon("permanentDelete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Permanent delete confirm */}
      {confirmPermTag && (
        <ConfirmDialog
          open
          title={`${tCommon("permanentDelete")} "${confirmPermTag.name}"`}
          description={t("permanentDeleteTagDesc")}
          confirmLabel={tCommon("permanentDelete")}
          danger
          onConfirm={() => handlePermanentDeleteTag(confirmPermTag)}
          onCancel={() => setConfirmPermTag(null)}
        />
      )}
    </div>
  );
}
