/**
 * Workbench 状态模型 + reducer。
 *
 * 设计：
 *   - 根节点恒为 AND group（不可删除、不可改变类型）。
 *   - 根的 children 是一个 LeafNode 或 OrGroupNode 数组。
 *   - OrGroupNode 的 children 只能是 LeafNode（不嵌套 OR；保持视觉简洁）。
 *   - 每个 LeafNode 可独立切换 NOT。
 *   - 元数据 leaf（source/status/confidence）用三种独立 leaf type 表达。
 *
 * BoolExpr 编译规则：
 *   - 根 AND：{ and: [...children] }，但只有 1 个 child 时直接返回该 child。
 *   - OR group：{ or: [...leaves] }，1 leaf 时直接 unwrap。
 *   - Leaf + negate=true：{ not: leafExpr }。
 *
 * 此模块纯函数，不依赖 React，便于测试。
 */
import type { BoolExpr } from "@/lib/api";

// ── Leaf 类型 ────────────────────────────────────────────────────────────────
export type LeafValue =
  | { type: "tag";          tagId: string;          tagName: string; groupName: string }
  | { type: "descendantOf"; tagId: string;          tagName: string; groupName: string }
  | { type: "tagAlias";     alias: string;          groupSlug?: string; matchedTagIds?: string[] }
  | { type: "source";       values: ("manual" | "ai" | "system" | "import")[] }
  | { type: "status";       values: ("active" | "pending" | "rejected")[] }
  | { type: "confidence";   gte?: number; lte?: number };

export interface LeafNode {
  kind:   "leaf";
  id:     string;
  value:  LeafValue;
  negate: boolean;
}

export interface OrGroupNode {
  kind:     "or";
  id:       string;
  children: LeafNode[];
}

export type ChildNode = LeafNode | OrGroupNode;

export interface WorkbenchState {
  children: ChildNode[];   // root 恒为 AND，这里是它的 children
}

export const INITIAL_STATE: WorkbenchState = { children: [] };

// ── 动作 ────────────────────────────────────────────────────────────────────
export type Action =
  | { type: "add-leaf";       value: LeafValue;                       targetGroupId?: string }
  | { type: "add-or-group" }
  | { type: "remove";         nodeId: string }
  | { type: "toggle-not";     nodeId: string }
  | { type: "update-leaf";    nodeId: string; value: LeafValue }
  | { type: "reset" }
  | { type: "load";           state: WorkbenchState };

let _idSeq = 0;
const nextId = (prefix = "n") => `${prefix}_${Date.now().toString(36)}_${(++_idSeq).toString(36)}`;

// ── reducer ─────────────────────────────────────────────────────────────────
export function reducer(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case "add-leaf": {
      const leaf: LeafNode = { kind: "leaf", id: nextId("l"), value: action.value, negate: false };
      // 加到指定 OR group 内
      if (action.targetGroupId) {
        return {
          children: state.children.map(c =>
            c.kind === "or" && c.id === action.targetGroupId
              ? { ...c, children: [...c.children, leaf] }
              : c
          ),
        };
      }
      // 加到 root AND
      return { children: [...state.children, leaf] };
    }
    case "add-or-group": {
      const group: OrGroupNode = { kind: "or", id: nextId("g"), children: [] };
      return { children: [...state.children, group] };
    }
    case "remove": {
      // 删除根级节点
      const filteredRoot = state.children.filter(c => c.id !== action.nodeId);
      if (filteredRoot.length !== state.children.length) {
        return { children: filteredRoot };
      }
      // 删除 OR group 内的 leaf
      return {
        children: state.children.map(c => {
          if (c.kind === "or") {
            const filtered = c.children.filter(l => l.id !== action.nodeId);
            return filtered.length === c.children.length ? c : { ...c, children: filtered };
          }
          return c;
        }),
      };
    }
    case "toggle-not": {
      return {
        children: state.children.map(c => {
          if (c.kind === "leaf" && c.id === action.nodeId) {
            return { ...c, negate: !c.negate };
          }
          if (c.kind === "or") {
            return {
              ...c,
              children: c.children.map(l =>
                l.id === action.nodeId ? { ...l, negate: !l.negate } : l
              ),
            };
          }
          return c;
        }),
      };
    }
    case "update-leaf": {
      return {
        children: state.children.map(c => {
          if (c.kind === "leaf" && c.id === action.nodeId) {
            return { ...c, value: action.value };
          }
          if (c.kind === "or") {
            return {
              ...c,
              children: c.children.map(l =>
                l.id === action.nodeId ? { ...l, value: action.value } : l
              ),
            };
          }
          return c;
        }),
      };
    }
    case "reset":
      return INITIAL_STATE;
    case "load":
      return action.state;
  }
}

// ── 编译：state → BoolExpr ─────────────────────────────────────────────────
export function compileLeafValue(v: LeafValue): BoolExpr {
  switch (v.type) {
    case "tag":          return { tag: v.tagId };
    case "descendantOf": return { descendantOf: v.tagId };
    case "tagAlias":     return v.groupSlug ? { tagAlias: v.alias, groupSlug: v.groupSlug } : { tagAlias: v.alias };
    case "source":       return { source: v.values };
    case "status":       return { status: v.values };
    case "confidence": {
      const c: { gte?: number; lte?: number } = {};
      if (v.gte !== undefined) c.gte = v.gte;
      if (v.lte !== undefined) c.lte = v.lte;
      return { confidence: c };
    }
  }
}

function compileLeafNode(l: LeafNode): BoolExpr {
  const expr = compileLeafValue(l.value);
  return l.negate ? { not: expr } : expr;
}

function compileChild(node: ChildNode): BoolExpr | null {
  if (node.kind === "leaf") return compileLeafNode(node);
  // OR group
  const exprs = node.children.map(compileLeafNode);
  if (exprs.length === 0) return null;
  if (exprs.length === 1) return exprs[0];
  return { or: exprs };
}

/**
 * 把 workbench 内部状态编译为最终 BoolExpr。
 * 空 state → undefined（无过滤）。
 */
export function compileState(state: WorkbenchState): BoolExpr | undefined {
  const exprs = state.children
    .map(compileChild)
    .filter((e): e is BoolExpr => e !== null);
  if (exprs.length === 0) return undefined;
  if (exprs.length === 1) return exprs[0];
  return { and: exprs };
}

// ── 节点描述（用于 chip 显示）────────────────────────────────────────────
export function describeLeaf(v: LeafValue): string {
  switch (v.type) {
    case "tag":          return `${v.groupName} ▸ ${v.tagName}`;
    case "descendantOf": return `${v.groupName} ▸ ${v.tagName} (含子孙)`;
    case "tagAlias":     return v.groupSlug ? `别名 "${v.alias}" @${v.groupSlug}` : `别名 "${v.alias}"`;
    case "source":       return `来源: ${v.values.join(" / ")}`;
    case "status":       return `状态: ${v.values.join(" / ")}`;
    case "confidence": {
      const gte = v.gte !== undefined ? `≥ ${v.gte}` : "";
      const lte = v.lte !== undefined ? `≤ ${v.lte}` : "";
      return `置信度 ${gte}${gte && lte ? "，" : ""}${lte}` || "置信度";
    }
  }
}
