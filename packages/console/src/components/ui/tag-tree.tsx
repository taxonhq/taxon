"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  useDraggable,
  useDroppable,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import { GripVertical, ChevronRight, ChevronDown, Pencil, Trash2, Plus, X, Tag, GitMerge, FolderInput } from "lucide-react";
import { createTagAlias, deleteTagAlias, getTagAliases, type TagTreeNode, type TagAlias } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────

export interface TagTreeCallbacks {
  onMove:      (tagId: string, newParentId: string | null) => Promise<void>;
  onEdit:      (tag: TagTreeNode) => void;
  onDelete:    (tag: TagTreeNode) => void;
  onAdd:       (parentId: string | null) => void;
  onMerge?:    (tag: TagTreeNode) => void;
  onMoveGroup?:(tag: TagTreeNode) => void;
}

// ── DnD IDs ───────────────────────────────────────────────────────

const ROOT_DROP_ID = "__root__";

// ── Alias sub-panel ───────────────────────────────────────────────

function AliasPanel({ tagId, initialAliases }: { tagId: string; initialAliases?: TagAlias[] }) {
  const t = useTranslations("groups");
  const [aliases, setAliases]   = useState<TagAlias[]>(initialAliases ?? []);
  const [inputVal, setInputVal] = useState("");
  const [adding, setAdding]     = useState(false);
  const [error, setError]       = useState("");

  const load = useCallback(async () => {
    try { setAliases(await getTagAliases(tagId)); } catch { /* ignore */ }
  }, [tagId]);

  const handleAdd = async () => {
    const v = inputVal.trim();
    if (!v) return;
    setAdding(true); setError("");
    try {
      const created = await createTagAlias(tagId, v);
      setAliases(prev => [...prev, created]);
      setInputVal("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aliasAddFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (aliasId: string) => {
    try {
      await deleteTagAlias(tagId, aliasId);
      setAliases(prev => prev.filter(a => a.id !== aliasId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("aliasDeleteFailed"));
    }
  };

  // 首次展开时若无初始数据则拉取（放在 effect 中，避免渲染期间读写 ref）
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!fetchedRef.current && !initialAliases) {
      fetchedRef.current = true;
      load();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load on mount only

  return (
    <div className="mt-1 mb-1 ml-10 px-3 py-2 rounded-md bg-surface-alt/50 border border-edge/40 space-y-2">
      {/* alias chips */}
      <div className="flex flex-wrap gap-1.5 min-h-5">
        {aliases.length === 0 && (
          <span className="text-xs text-ink-faint italic">{t("aliasNone")}</span>
        )}
        {aliases.map(a => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-edge/60 text-xs text-ink-dim font-mono group/chip"
          >
            {a.alias}
            <button
              onClick={() => handleDelete(a.id)}
              className="text-ink-faint hover:text-bad opacity-0 group-hover/chip:opacity-100 transition-opacity"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>

      {/* add input */}
      <div className="flex items-center gap-2">
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setInputVal(""); }}
          placeholder={t("aliasPlaceholder")}
          className="flex-1 text-xs bg-transparent border border-edge-mid rounded px-2 py-1 text-ink placeholder:text-ink-faint focus:outline-none focus:border-edge-strong"
        />
        <button
          onClick={handleAdd}
          disabled={!inputVal.trim() || adding}
          className="text-xs text-ink-faint hover:text-ink disabled:opacity-40 transition-colors"
        >
          <Plus size={13} />
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

// ── Single node (draggable + droppable) ──────────────────────────

interface NodeProps {
  node:      TagTreeNode;
  callbacks: TagTreeCallbacks;
  draggingId: string | null;
  overId:     string | null;
  allNodes:   Map<string, TagTreeNode>;
  accent:     string;
  maxCount:   number;
}

function TagNode({ node, callbacks, draggingId, overId, allNodes, accent, maxCount }: NodeProps) {
  const t = useTranslations("groups");
  const tCommon = useTranslations("common");
  const [open, setOpen]           = useState(true);
  const [aliasOpen, setAliasOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const aliasCount  = node.aliases?.length ?? 0;

  const usage = node._count?.entityTags ?? 0;
  const usagePct = maxCount > 0 ? Math.max(usage > 0 ? 4 : 0, (usage / maxCount) * 100) : 0;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id:   node.id,
    data: { node },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id:   node.id,
    data: { node },
  });

  const isDraggingOver = isOver && draggingId !== null && draggingId !== node.id
    && !isDescendant(allNodes, draggingId, node.id);

  const setRef = (el: HTMLElement | null) => { setDragRef(el); setDropRef(el); };

  if (isDragging) {
    return (
      <div className="pl-5 opacity-30 pointer-events-none">
        <div className="flex items-center gap-1.5 py-1.5 px-2 rounded-md bg-surface-alt border border-dashed border-edge">
          <GripVertical size={13} className="text-ink-faint shrink-0" />
          <span className="text-sm text-ink-faint">{node.name}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* node row */}
      <div
        ref={setRef}
        className={[
          "flex items-center gap-1 py-1.5 px-2 rounded-md group/node transition-colors",
          isDraggingOver ? "bg-brand-1/10 ring-1 ring-brand-1/40" : "hover:bg-row-hover",
        ].join(" ")}
      >
        {/* expand/collapse children */}
        <button
          className="w-4 h-4 flex items-center justify-center text-ink-faint shrink-0"
          onClick={() => setOpen(v => !v)}
          tabIndex={-1}
        >
          {hasChildren
            ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} />
            : <span className="w-3" />}
        </button>

        {/* drag handle */}
        <button
          className="text-ink-faint cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover/node:opacity-100 transition-opacity"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={13} />
        </button>

        {/* label */}
        <span className="text-sm text-ink truncate shrink-0 max-w-[45%]">{node.name}</span>
        <span className="text-xs text-ink-faint font-mono shrink-0 hidden group-hover/node:inline">{node.slug}</span>

        {/* usage bar — 占据中段空白，把名称与数值连成一行（修 #107 哑铃行） */}
        <div
          className="flex-1 min-w-6 mx-1 h-1.5 rounded-full overflow-hidden"
          style={{ background: "color-mix(in srgb, var(--color-ink) 8%, transparent)" }}
          aria-hidden="true"
        >
          {usagePct > 0 && (
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${usagePct}%`, background: `color-mix(in srgb, ${accent} 78%, transparent)` }}
            />
          )}
        </div>

        {/* usage count — tabular，带单位 tooltip（修 #107 无表头/单位） */}
        <span
          className="text-xs text-ink-dim font-mono tabular-nums shrink-0 w-12 text-right"
          title={t("tagUsageCount")}
        >
          {usage.toLocaleString()}
        </span>

        {/* actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/node:opacity-100 transition-opacity ml-1">
          {/* alias toggle */}
          <button
            onClick={() => setAliasOpen(v => !v)}
            className={[
              "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs transition-colors",
              aliasOpen
                ? "text-ink bg-surface-alt"
                : "text-ink-faint hover:text-ink hover:bg-surface-alt",
            ].join(" ")}
            aria-label={t("nodeManageAlias")}
            title={t("nodeManageAlias")}
          >
            <Tag size={11} />
            {aliasCount > 0 && <span>{aliasCount}</span>}
          </button>

          <button onClick={() => callbacks.onAdd(node.id)} className="p-1 rounded text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors" aria-label={t("nodeAddChild")} title={t("nodeAddChild")}>
            <Plus size={12} />
          </button>
          {callbacks.onMerge && (
            <button onClick={() => callbacks.onMerge!(node)} className="p-1 rounded text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors" aria-label={t("nodeMerge")} title={t("nodeMerge")}>
              <GitMerge size={12} />
            </button>
          )}
          {callbacks.onMoveGroup && (
            <button onClick={() => callbacks.onMoveGroup!(node)} className="p-1 rounded text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors" aria-label={t("nodeMoveGroup")} title={t("nodeMoveGroup")}>
              <FolderInput size={12} />
            </button>
          )}
          <button onClick={() => callbacks.onEdit(node)} className="p-1 rounded text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors" aria-label={tCommon("edit")} title={tCommon("edit")}>
            <Pencil size={12} />
          </button>
          <button onClick={() => callbacks.onDelete(node)} className="p-1 rounded text-bad/60 hover:text-bad hover:bg-bad/10 transition-colors" aria-label={tCommon("delete")} title={tCommon("delete")}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* alias panel */}
      {aliasOpen && (
        <AliasPanel tagId={node.id} initialAliases={node.aliases} />
      )}

      {/* children */}
      {hasChildren && open && (
        <div className="ml-5 pl-2 border-l border-edge/50">
          {node.children.map(child => (
            <TagNode
              key={child.id}
              node={child}
              callbacks={callbacks}
              draggingId={draggingId}
              overId={overId}
              allNodes={allNodes}
              accent={accent}
              maxCount={maxCount}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root droppable zone ────────────────────────────────────────────

function RootDropZone({ isActive }: { isActive: boolean }) {
  const t = useTranslations("groups");
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID });
  if (!isActive) return null;
  return (
    <div
      ref={setNodeRef}
      className={[
        "mt-2 h-8 rounded-md border-2 border-dashed flex items-center justify-center text-xs transition-colors",
        isOver ? "border-brand-1 text-brand-1 bg-brand-1/5" : "border-edge text-ink-faint",
      ].join(" ")}
    >
      {t("treeRootDrop")}
    </div>
  );
}

// ── DragOverlay content ────────────────────────────────────────────

function DragGhost({ node }: { node: TagTreeNode }) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 px-3 rounded-md bg-surface-alt border border-edge shadow-lg text-sm text-ink opacity-90 select-none">
      <GripVertical size={13} className="text-ink-faint" />
      {node.name}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function buildMap(nodes: TagTreeNode[], map = new Map<string, TagTreeNode>()): Map<string, TagTreeNode> {
  for (const n of nodes) { map.set(n.id, n); buildMap(n.children, map); }
  return map;
}

function isDescendant(map: Map<string, TagTreeNode>, potentialAncestorId: string, nodeId: string): boolean {
  let cur: TagTreeNode | undefined = map.get(nodeId);
  while (cur) {
    if (cur.id === potentialAncestorId) return true;
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return false;
}

// ── Public component ──────────────────────────────────────────────

interface TagTreeProps {
  nodes:     TagTreeNode[];
  callbacks: TagTreeCallbacks;
  /** 分组主色（呼应跨页色彩系统）——用于使用度进度条 */
  accent?:   string;
}

export function TagTree({ nodes, callbacks, accent = "var(--color-brand-1)" }: TagTreeProps) {
  const t = useTranslations("groups");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId]         = useState<string | null>(null);
  const movingRef                   = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const allNodes    = buildMap(nodes);
  const draggingNode = draggingId ? allNodes.get(draggingId) : null;

  // 全树使用度峰值 —— 进度条按它归一化，跨层级可比
  let maxCount = 0;
  for (const n of allNodes.values()) maxCount = Math.max(maxCount, n._count?.entityTags ?? 0);

  const handleDragStart = (e: DragStartEvent) => setDraggingId(String(e.active.id));
  const handleDragOver  = (e: DragOverEvent)  => setOverId(e.over ? String(e.over.id) : null);

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingId(null);
    setOverId(null);
    if (!e.over || movingRef.current) return;

    const draggedId = String(e.active.id);
    const dropId    = String(e.over.id);
    if (draggedId === dropId) return;

    const dragged = allNodes.get(draggedId);
    if (!dragged) return;

    if (dropId === ROOT_DROP_ID) {
      if (dragged.parentId === null) return;
      movingRef.current = true;
      try { await callbacks.onMove(draggedId, null); } finally { movingRef.current = false; }
      return;
    }

    const target = allNodes.get(dropId);
    if (!target) return;
    if (isDescendant(allNodes, draggedId, dropId)) return;
    if (dragged.parentId === target.id) return;

    movingRef.current = true;
    try { await callbacks.onMove(draggedId, target.id); } finally { movingRef.current = false; }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {nodes.length === 0 ? (
        <p className="text-sm text-ink-faint py-6 text-center">{t("treeNoTags")}</p>
      ) : (
        nodes.map(node => (
          <TagNode
            key={node.id}
            node={node}
            callbacks={callbacks}
            draggingId={draggingId}
            overId={overId}
            allNodes={allNodes}
            accent={accent}
            maxCount={maxCount}
          />
        ))
      )}
      <RootDropZone isActive={!!draggingId} />
      <DragOverlay>
        {draggingNode ? <DragGhost node={draggingNode} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
