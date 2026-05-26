"use client";

import { useState } from "react";
import {
  Tag as TagIcon, GitBranch, Languages, Cpu, CheckCircle2, Gauge,
  X, Slash, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeafNode, LeafValue, OrGroupNode } from "./state";
import { describeLeaf } from "./state";

// ── leaf 类型 icon ──────────────────────────────────────────────────────────
function leafIcon(v: LeafValue) {
  switch (v.type) {
    case "tag":          return TagIcon;
    case "descendantOf": return GitBranch;
    case "tagAlias":     return Languages;
    case "source":       return Cpu;
    case "status":       return CheckCircle2;
    case "confidence":   return Gauge;
  }
}

// ── 单个 leaf chip ─────────────────────────────────────────────────────────
export function LeafChip({
  node, onRemove, onToggleNot,
}: {
  node: LeafNode;
  onRemove: () => void;
  onToggleNot: () => void;
}) {
  const Icon = leafIcon(node.value);
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-sm transition-colors",
      node.negate
        ? "border-bad/40 bg-bad/5 text-bad"
        : "border-edge-mid bg-overlay text-ink",
    )}>
      <Icon className={cn("size-3.5 shrink-0", node.negate ? "text-bad" : "text-ink-sub")} />
      {node.negate && <span className="text-xs font-semibold tracking-tight">NOT</span>}
      <span className="truncate max-w-[260px]">{describeLeaf(node.value)}</span>
      <button
        type="button"
        onClick={onToggleNot}
        title={node.negate ? "取消反向（NOT）" : "标记为反向（NOT）"}
        className={cn(
          "ml-0.5 size-4 inline-flex items-center justify-center rounded transition-colors",
          node.negate ? "hover:bg-bad/15 text-bad" : "hover:bg-row-head text-ink-sub",
        )}
      >
        <Slash className="size-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="移除"
        className="size-4 inline-flex items-center justify-center rounded hover:bg-row-head text-ink-sub"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

// ── OR group 容器 ──────────────────────────────────────────────────────────
export function OrGroupChip({
  group, onRemoveGroup, onRemoveLeaf, onToggleNot, onAddLeaf,
}: {
  group: OrGroupNode;
  onRemoveGroup: () => void;
  onRemoveLeaf: (leafId: string) => void;
  onToggleNot: (leafId: string) => void;
  onAddLeaf: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg border border-edge bg-card/60">
      <span className="text-xs font-semibold text-ok tracking-wide">OR</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {group.children.length === 0 && (
          <span className="text-xs text-ink-faint italic">空 OR 组</span>
        )}
        {group.children.map((l, i) => (
          <span key={l.id} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-xs text-ok/60 font-medium">或</span>}
            <LeafChip
              node={l}
              onRemove={() => onRemoveLeaf(l.id)}
              onToggleNot={() => onToggleNot(l.id)}
            />
          </span>
        ))}
        <button
          type="button"
          onClick={onAddLeaf}
          title="向此 OR 组添加标签"
          className="size-5 inline-flex items-center justify-center rounded-md border border-dashed border-edge-mid text-ink-sub hover:text-ink hover:border-edge-strong"
        >
          <Plus className="size-3" />
        </button>
      </div>
      <button
        type="button"
        onClick={onRemoveGroup}
        title="删除整个 OR 组"
        className="size-5 inline-flex items-center justify-center rounded hover:bg-row-head text-ink-sub"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ── 元数据 chip 编辑器（source / status / confidence）────────────────────
const SRC_OPTS: { v: "manual" | "ai" | "system" | "import"; label: string }[] = [
  { v: "manual", label: "人工" }, { v: "ai", label: "AI" },
  { v: "system", label: "系统" }, { v: "import", label: "导入" },
];
const STATUS_OPTS: { v: "active" | "pending" | "rejected"; label: string }[] = [
  { v: "active", label: "已生效" }, { v: "pending", label: "待审核" }, { v: "rejected", label: "已拒绝" },
];

export function MetaPicker({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: LeafValue) => void;
}) {
  const [tab, setTab] = useState<"source" | "status" | "confidence">("source");
  const [src, setSrc] = useState<("manual" | "ai" | "system" | "import")[]>([]);
  const [st, setSt]   = useState<("active" | "pending" | "rejected")[]>([]);
  const [gte, setGte] = useState<string>("");
  const [lte, setLte] = useState<string>("");

  if (!open) return null;

  const submit = () => {
    if (tab === "source" && src.length > 0) {
      onPick({ type: "source", values: src });
      reset(); onClose();
    } else if (tab === "status" && st.length > 0) {
      onPick({ type: "status", values: st });
      reset(); onClose();
    } else if (tab === "confidence" && (gte || lte)) {
      const v: LeafValue = { type: "confidence" };
      if (gte) v.gte = Number(gte);
      if (lte) v.lte = Number(lte);
      onPick(v);
      reset(); onClose();
    }
  };

  const reset = () => { setSrc([]); setSt([]); setGte(""); setLte(""); };

  const toggle = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[420px] rounded-xl border border-edge bg-card shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-edge flex items-center">
          <span className="text-base font-medium text-ink">添加元数据过滤</span>
          <button onClick={() => { reset(); onClose(); }} className="ml-auto text-ink-sub hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex border-b border-edge">
          {[
            { id: "source", label: "来源" }, { id: "status", label: "状态" }, { id: "confidence", label: "置信度" },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as "source" | "status" | "confidence")}
              className={cn(
                "flex-1 py-2.5 text-base transition-colors",
                tab === t.id ? "text-ink font-medium border-b-2 border-ink -mb-px" : "text-ink-sub hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-4 space-y-3">
          {tab === "source" && (
            <div className="flex flex-wrap gap-1.5">
              {SRC_OPTS.map(o => (
                <Chip key={o.v} active={src.includes(o.v)} onClick={() => setSrc(toggle(src, o.v))}>
                  {o.label}
                </Chip>
              ))}
            </div>
          )}
          {tab === "status" && (
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTS.map(o => (
                <Chip key={o.v} active={st.includes(o.v)} onClick={() => setSt(toggle(st, o.v))}>
                  {o.label}
                </Chip>
              ))}
            </div>
          )}
          {tab === "confidence" && (
            <div className="flex items-center gap-2 text-base">
              <input
                type="number" min={0} max={1} step={0.05} value={gte} placeholder="≥"
                onChange={e => setGte(e.target.value)}
                className="w-24 px-2 py-1.5 rounded-md border border-edge bg-input text-ink"
              />
              <span className="text-ink-sub">~</span>
              <input
                type="number" min={0} max={1} step={0.05} value={lte} placeholder="≤"
                onChange={e => setLte(e.target.value)}
                className="w-24 px-2 py-1.5 rounded-md border border-edge bg-input text-ink"
              />
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="px-3 py-1.5 rounded-md border border-edge text-base text-ink hover:bg-row-hover"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={
              (tab === "source" && src.length === 0) ||
              (tab === "status" && st.length === 0) ||
              (tab === "confidence" && !gte && !lte)
            }
            className="px-3 py-1.5 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "px-2.5 py-0.5 rounded-full border text-sm transition-colors",
        active
          ? "border-ink bg-ink text-surface font-medium"
          : "border-edge text-ink-sub hover:text-ink hover:border-edge-mid",
      )}
    >{children}</button>
  );
}

// ── 别名输入 ────────────────────────────────────────────────────────────────
export function AliasPicker({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: LeafValue) => void;
}) {
  const [alias, setAlias] = useState("");
  const [groupSlug, setGroupSlug] = useState("");

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[440px] rounded-xl border border-edge bg-card shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-edge flex items-center">
          <Languages className="size-4 text-ink-sub mr-2" />
          <span className="text-base font-medium text-ink">按别名匹配</span>
          <button onClick={onClose} className="ml-auto text-ink-sub hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-ink-sub block mb-1">别名</label>
            <input
              autoFocus
              type="text"
              value={alias}
              onChange={e => setAlias(e.target.value)}
              placeholder='例如："麻辣"、"spicy"'
              className="w-full px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            />
          </div>
          <div>
            <label className="text-xs text-ink-sub block mb-1">限定分组 slug（可选）</label>
            <input
              type="text"
              value={groupSlug}
              onChange={e => setGroupSlug(e.target.value)}
              placeholder="例如：cuisine、taste；空=跨分组匹配"
              className="w-full px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            />
          </div>
          <p className="text-xs text-ink-faint">别名匹配可命中多个 tag — 该 leaf 等价于「这些 tag 中任意一个命中」</p>
        </div>
        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-edge text-base text-ink hover:bg-row-hover"
          >取消</button>
          <button
            type="button"
            onClick={() => {
              onPick({
                type: "tagAlias",
                alias: alias.trim(),
                groupSlug: groupSlug.trim() || undefined,
              });
              setAlias(""); setGroupSlug(""); onClose();
            }}
            disabled={!alias.trim()}
            className="px-3 py-1.5 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 disabled:opacity-50"
          >添加</button>
        </div>
      </div>
    </div>
  );
}
