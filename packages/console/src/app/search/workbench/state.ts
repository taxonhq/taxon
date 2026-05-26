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

// ── BoolExpr → WorkbenchState 反编译 ───────────────────────────────────────
// 用于：NL / DSL 模式生成的 BoolExpr 反向填入工作台 chip 区。
//
// 限制：workbench state 只支持 "AND of [Leaf | NegLeaf | OR(Leaves)]" 结构，
// 因此能反编译的 BoolExpr 形态有限。无法映射时返回 null（调用方应回退到 DSL 模式）。
//
// 因为 tag/descendantOf leaf 需要 tagName/groupName 用于 chip 展示，
// 反编译需要一个 resolver 把 tagId 解析为这些字段。
//
// 设计：递归归一化 — 任何根 leaf 先包成 AND([leaf])，然后逐一处理 children。
export interface TagInfo {
  tagId:     string
  tagName:   string
  groupSlug: string
  groupName: string
}
export type TagResolver = (tagId: string) => TagInfo | undefined

interface RawBoolLeaf {
  tag?: string
  tagSlug?: string; groupSlug?: string
  tagAlias?: string
  descendantOf?: string
  source?: ('manual' | 'ai' | 'system' | 'import')[]
  confidence?: { gte?: number; lte?: number }
  status?: ('active' | 'pending' | 'rejected')[]
}
interface RawBoolExpr extends RawBoolLeaf {
  and?: RawBoolExpr[]
  or?:  RawBoolExpr[]
  not?: RawBoolExpr
}

function isLeaf(e: RawBoolExpr): boolean {
  return !('and' in e || 'or' in e || 'not' in e)
}

/** 把 leaf BoolExpr → LeafValue。tag/descendantOf 优先用 resolver，
 *  resolver 失败时用 tagId 自身占位（功能保留，只是 chip 显示不完美）。*/
function leafToValue(e: RawBoolLeaf, resolve: TagResolver): LeafValue | null {
  if (e.tag) {
    const info = resolve(e.tag)
    return {
      type: 'tag',
      tagId:     info?.tagId    ?? e.tag,
      tagName:   info?.tagName  ?? e.tag,
      groupName: info?.groupName ?? '?',
    }
  }
  if (e.tagSlug) {
    // tagSlug 没有 tagId，反编译为占位（展示用 slug 本身 + group hint）
    return { type: 'tag', tagId: '', tagName: e.tagSlug, groupName: e.groupSlug ?? '?' }
  }
  if (e.tagAlias) {
    return { type: 'tagAlias', alias: e.tagAlias, groupSlug: e.groupSlug }
  }
  if (e.descendantOf) {
    const info = resolve(e.descendantOf)
    return {
      type: 'descendantOf',
      tagId:     info?.tagId    ?? e.descendantOf,
      tagName:   info?.tagName  ?? e.descendantOf,
      groupName: info?.groupName ?? '?',
    }
  }
  if (e.source && e.source.length > 0) return { type: 'source', values: e.source }
  if (e.status && e.status.length > 0) return { type: 'status', values: e.status }
  if (e.confidence) {
    const c: LeafValue & { type: 'confidence' } = { type: 'confidence' }
    if (e.confidence.gte !== undefined) c.gte = e.confidence.gte
    if (e.confidence.lte !== undefined) c.lte = e.confidence.lte
    return c
  }
  return null
}

let _decompIdSeq = 0
const decompId = (prefix = 'd') => `${prefix}_${Date.now().toString(36)}_${(++_decompIdSeq).toString(36)}`

/** 把 BoolExpr 根节点归一化为一个 AND children 数组（不改变语义）。 */
function flattenToAndChildren(expr: RawBoolExpr): RawBoolExpr[] {
  if (expr.and) return expr.and.flatMap(flattenToAndChildren)
  return [expr]
}

/**
 * 反编译 BoolExpr。
 * @returns WorkbenchState；遇到无法映射的嵌套结构（如 OR 内嵌 AND）返回 null
 */
export function decompileBoolExpr(
  expr: unknown,
  resolve: TagResolver,
): WorkbenchState | null {
  if (!expr || typeof expr !== 'object') return null
  const e = expr as RawBoolExpr

  // 把根归一为 AND children 列表
  const andChildren = flattenToAndChildren(e)
  const result: ChildNode[] = []

  for (const child of andChildren) {
    // case 1: leaf
    if (isLeaf(child)) {
      const v = leafToValue(child, resolve)
      if (!v) return null
      result.push({ kind: 'leaf', id: decompId('l'), value: v, negate: false })
      continue
    }
    // case 2: not(leaf) - 只支持 not 包 leaf
    if (child.not) {
      if (!isLeaf(child.not)) return null  // not(or/and) 不支持
      const v = leafToValue(child.not, resolve)
      if (!v) return null
      result.push({ kind: 'leaf', id: decompId('l'), value: v, negate: true })
      continue
    }
    // case 3: or - or 的 children 只能是 leaf 或 not(leaf)
    if (child.or) {
      const orChildren: LeafNode[] = []
      for (const orLeaf of child.or) {
        if (isLeaf(orLeaf)) {
          const v = leafToValue(orLeaf, resolve)
          if (!v) return null
          orChildren.push({ kind: 'leaf', id: decompId('l'), value: v, negate: false })
        } else if (orLeaf.not && isLeaf(orLeaf.not)) {
          const v = leafToValue(orLeaf.not, resolve)
          if (!v) return null
          orChildren.push({ kind: 'leaf', id: decompId('l'), value: v, negate: true })
        } else {
          return null  // or 内含 and 或更深嵌套，不支持
        }
      }
      result.push({ kind: 'or', id: decompId('g'), children: orChildren })
      continue
    }
    // case 4: nested and inside and（理论上已被 flatten 处理掉）
    return null
  }

  return { children: result }
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
