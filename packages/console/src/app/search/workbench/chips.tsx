"use client";

import { createElement, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Tag as TagIcon, GitBranch, Languages, Cpu, CheckCircle2, Gauge, Search,
  X, Slash, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeafNode, LeafValue, OrGroupNode, LeafLabels } from "./state";
import { describeLeaf } from "./state";

// ── leaf 类型 icon ──────────────────────────────────────────────────────────
function leafIcon(v: LeafValue) {
  switch (v.type) {
    case "tag":          return TagIcon;
    case "descendantOf": return GitBranch;
    case "tagAlias":     return Languages;
    case "text":         return Search;
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
  const t = useTranslations("search");
  const labels: LeafLabels = {
    descendantSuffix: t("chipDescendantSuffix"),
    source:           t("chipSource"),
    status:           t("chipStatus"),
    confidence:       t("chipConfidence"),
    text:             t("chipText"),
    alias: (alias, groupSlug) =>
      groupSlug ? t("chipAliasAt", { alias, group: groupSlug }) : t("chipAlias", { alias }),
  };
  // 用 createElement 而非 `const Icon = leafIcon(...)` + `<Icon />`，
  // 避免 react-hooks/static-components 把这种"渲染期定义组件"的模式判错。
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-sm transition-colors",
      node.negate
        ? "border-bad/40 bg-bad/5 text-bad"
        : "border-edge-mid bg-overlay text-ink",
    )}>
      {createElement(leafIcon(node.value), {
        className: cn("size-3.5 shrink-0", node.negate ? "text-bad" : "text-ink-sub"),
      })}
      {node.negate && <span className="text-xs font-semibold tracking-tight">NOT</span>}
      <span className="truncate max-w-[260px]">{describeLeaf(node.value, labels)}</span>
      <button
        type="button"
        onClick={onToggleNot}
        aria-label={node.negate ? t("chipUnsetNot") : t("chipToggleNot")}
        title={node.negate ? t("chipUnsetNot") : t("chipToggleNot")}
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
        aria-label={t("chipRemove")}
        title={t("chipRemove")}
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
  const t = useTranslations("search");
  // OR 组用 ok 色 ring + 浅背景，与 AND 链清晰区分：
  // 同一 AND 链上的 chip 是并列条件（AND 文字分隔），
  // OR 组是一个"子表达式"，整体作为 AND 链的一项。
  return (
    <div className="inline-flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg border border-ok/30 bg-ok/5 ring-1 ring-ok/10">
      <span className="text-2xs font-bold text-ok tracking-[0.1em] uppercase">OR</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {group.children.length === 0 && (
          <span className="text-xs text-ink-faint italic">{t("wbEmptyOrGroup")}</span>
        )}
        {group.children.map((l, i) => (
          <span key={l.id} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-xs text-ok/60 font-medium">{t("wbOr")}</span>}
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
          aria-label={t("orAddTag")}
          title={t("orAddTag")}
          className="size-5 inline-flex items-center justify-center rounded-md border border-dashed border-edge-mid text-ink-sub hover:text-ink hover:border-edge-strong"
        >
          <Plus className="size-3" />
        </button>
      </div>
      <button
        type="button"
        onClick={onRemoveGroup}
        aria-label={t("orRemoveGroup")}
        title={t("orRemoveGroup")}
        className="size-5 inline-flex items-center justify-center rounded hover:bg-row-head text-ink-sub"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ── 元数据 chip 编辑器（source / status / confidence）────────────────────
const SRC_OPTS: { v: "manual" | "ai" | "system" | "import"; key: "srcManual" | "srcAi" | "srcSystem" | "srcImport" }[] = [
  { v: "manual", key: "srcManual" }, { v: "ai", key: "srcAi" },
  { v: "system", key: "srcSystem" }, { v: "import", key: "srcImport" },
];
const STATUS_OPTS: { v: "active" | "pending" | "rejected"; key: "statusActive" | "statusPending" | "statusRejected" }[] = [
  { v: "active", key: "statusActive" }, { v: "pending", key: "statusPending" }, { v: "rejected", key: "statusRejected" },
];

export function MetaPicker({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: LeafValue) => void;
}) {
  const t = useTranslations("search");
  const tc = useTranslations("common");
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
          <span className="text-base font-medium text-ink">{t("metaTitle")}</span>
          <button onClick={() => { reset(); onClose(); }} className="ml-auto text-ink-sub hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex border-b border-edge">
          {([
            { id: "source", key: "metaTabSource" }, { id: "status", key: "metaTabStatus" }, { id: "confidence", key: "metaTabConfidence" },
          ] as const).map(tabDef => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={cn(
                "flex-1 py-2.5 text-base transition-colors",
                tab === tabDef.id ? "text-ink font-medium border-b-2 border-ink -mb-px" : "text-ink-sub hover:text-ink",
              )}
            >
              {t(tabDef.key)}
            </button>
          ))}
        </div>
        <div className="p-4 space-y-3">
          {tab === "source" && (
            <div className="flex flex-wrap gap-1.5">
              {SRC_OPTS.map(o => (
                <Chip key={o.v} active={src.includes(o.v)} onClick={() => setSrc(toggle(src, o.v))}>
                  {t(o.key)}
                </Chip>
              ))}
            </div>
          )}
          {tab === "status" && (
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTS.map(o => (
                <Chip key={o.v} active={st.includes(o.v)} onClick={() => setSt(toggle(st, o.v))}>
                  {t(o.key)}
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
            {tc("cancel")}
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
            {tc("add")}
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
  const t = useTranslations("search");
  const tc = useTranslations("common");
  const [alias, setAlias] = useState("");
  const [groupSlug, setGroupSlug] = useState("");

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[440px] rounded-xl border border-edge bg-card shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-edge flex items-center">
          <Languages className="size-4 text-ink-sub mr-2" />
          <span className="text-base font-medium text-ink">{t("aliasTitle")}</span>
          <button onClick={onClose} className="ml-auto text-ink-sub hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-ink-sub block mb-1">{t("aliasLabel")}</label>
            <input
              autoFocus
              type="text"
              value={alias}
              onChange={e => setAlias(e.target.value)}
              placeholder={t("aliasPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            />
          </div>
          <div>
            <label className="text-xs text-ink-sub block mb-1">{t("aliasGroupLabel")}</label>
            <input
              type="text"
              value={groupSlug}
              onChange={e => setGroupSlug(e.target.value)}
              placeholder={t("aliasGroupPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            />
          </div>
          <p className="text-xs text-ink-faint">{t("aliasHint")}</p>
        </div>
        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-edge text-base text-ink hover:bg-row-hover"
          >{tc("cancel")}</button>
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
          >{tc("add")}</button>
        </div>
      </div>
    </div>
  );
}

// ── 关键词（text leaf）输入弹窗 ───────────────────────────────────────────────
export function TextPicker({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: LeafValue) => void;
}) {
  const t = useTranslations("search");
  const tc = useTranslations("common");
  const [text, setText] = useState("");

  if (!open) return null;
  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onPick({ type: "text", text: v });
    setText("");
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-[440px] rounded-xl border border-edge bg-card shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-edge flex items-center">
          <Search className="size-4 text-ink-sub mr-2" />
          <span className="text-base font-medium text-ink">{t("textTitle")}</span>
          <button onClick={onClose} className="ml-auto text-ink-sub hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-ink-sub block mb-1">{t("textLabel")}</label>
            <input
              autoFocus
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submit(); }}
              placeholder={t("textPlaceholder")}
              className="w-full px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            />
          </div>
          <p className="text-xs text-ink-faint">{t("textHint")}</p>
        </div>
        <div className="px-4 py-3 border-t border-edge flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-edge text-base text-ink hover:bg-row-hover"
          >{tc("cancel")}</button>
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            className="px-3 py-1.5 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 disabled:opacity-50"
          >{tc("add")}</button>
        </div>
      </div>
    </div>
  );
}
