"use client";

/**
 * EntityGraph — 实体关系图谱（#100 + #109 无限画布）。二部图：实体 + 标签，边 = EntityTag。
 *
 * 复用菌丝渲染语言（发光菌核 + 菌丝边 + 分组配色 + d3-force）+ 无限画布相机
 * （usePanZoom：滚轮缩放、空白平移、节点拖拽），交互式累积懒加载、永不全量。
 *
 * 交互：点节点→展开邻居；拖节点→挪位；拖空白→平移；滚轮→缩放；实体 hover→「查看详情↗」。
 * 标签 = 发光圆形菌核（按 TagGroup 着色）；实体 = 奶白菱形（形状可辨）。
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Maximize2 } from "lucide-react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { getGraphFocus, getGraphNeighbors, type GraphData } from "@/lib/api";
import { usePanZoom } from "@/components/graph/use-pan-zoom";
import { groupColor } from "@/lib/group-color";

const W = 1600;
const H = 1100;

interface GNode extends SimulationNodeDatum {
  id: string;
  kind: "entity" | "tag";
  label: string;
  color: string;
  r: number;
  degree: number;
  groupSlug?: string;
  entityType?: string;
  entityId?: string;
}
const linkKey = (a: string, b: string) => `${a} ${b}`;

interface RNode {
  id: string; kind: "entity" | "tag"; label: string; color: string;
  r: number; degree: number; x: number; y: number; expanded: boolean;
  entityType?: string; entityId?: string;
}
interface REdge { key: string; ax: number; ay: number; bx: number; by: number; color: string; aId: string; bId: string }
interface Snapshot { nodes: RNode[]; edges: REdge[] }

export function EntityGraph({ entityType }: { entityType: string }) {
  const router = useRouter();
  const nodes = useRef<Map<string, GNode>>(new Map());
  const links = useRef<Set<string>>(new Set());
  const expanded = useRef<Set<string>>(new Set());

  const [snap, setSnap] = useState<Snapshot>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [hidePerf, setHidePerf] = useState(true);
  const hidePerfRef = useRef(hidePerf);
  useEffect(() => { hidePerfRef.current = hidePerf; }, [hidePerf]);

  const { containerRef, cam, transform, onWheel, onBackgroundPointerDown, onPointerMove, onPointerUp, fitBounds } = usePanZoom(W, H);
  const kRef = useRef(cam.k);
  useEffect(() => { kRef.current = cam.k; }, [cam.k]);

  // 自适应到节点包围盒（而非整个世界）
  const fitContent = useCallback(() => {
    const ns = [...nodes.current.values()];
    if (ns.length === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      const r = n.r + 36;
      x0 = Math.min(x0, (n.x ?? W / 2) - r); y0 = Math.min(y0, (n.y ?? H / 2) - r);
      x1 = Math.max(x1, (n.x ?? W / 2) + r); y1 = Math.max(y1, (n.y ?? H / 2) + r);
    }
    fitBounds(x0, y0, x1, y1);
  }, [fitBounds]);

  // 由累积结构（ref）派生渲染快照（不跑布局）；仅在 effect/handler 调用
  const buildSnapshot = useCallback((): Snapshot => {
    // 隐藏压测数据：滤掉 perf-grp/性能 的标签节点（噪声），及触及它们的边
    const hidden = new Set<string>();
    if (hidePerfRef.current) {
      for (const n of nodes.current.values()) {
        if (n.kind === "tag" && /perf|性能/i.test(n.label)) hidden.add(n.id);
      }
    }
    const rnodes: RNode[] = [...nodes.current.values()].filter(n => !hidden.has(n.id)).map(n => ({
      id: n.id, kind: n.kind, label: n.label, color: n.color, r: n.r, degree: n.degree,
      x: n.x ?? W / 2, y: n.y ?? H / 2, expanded: expanded.current.has(n.id),
      entityType: n.entityType, entityId: n.entityId,
    }));
    const edges: REdge[] = [];
    for (const k of links.current) {
      const [s, t] = k.split(" ");
      if (hidden.has(s) || hidden.has(t)) continue;
      const a = nodes.current.get(s), b = nodes.current.get(t);
      if (!a || !b) continue;
      const tagNode = a.kind === "tag" ? a : b;
      edges.push({ key: k, ax: a.x ?? W / 2, ay: a.y ?? H / 2, bx: b.x ?? W / 2, by: b.y ?? H / 2, color: tagNode.color, aId: a.id, bId: b.id });
    }
    return { nodes: rnodes, edges };
  }, []);

  const merge = useCallback((data: GraphData, parentId?: string) => {
    const parent = parentId ? nodes.current.get(parentId) : undefined;
    for (const n of data.nodes) {
      const degree = (n.kind === "tag" ? n.entityCount : n.tagCount) ?? 0;
      const r = n.kind === "tag"
        ? Math.max(9, Math.min(40, 9 + Math.sqrt(degree) * 0.55))
        : Math.max(7, Math.min(24, 7 + Math.sqrt(degree) * 2.2));
      const existing = nodes.current.get(n.id);
      if (existing) { existing.degree = degree; existing.r = r; existing.label = n.label; }
      else {
        nodes.current.set(n.id, {
          id: n.id, kind: n.kind, label: n.label,
          color: n.kind === "tag" ? groupColor(n.groupId ?? n.groupSlug ?? n.id) : "#efe4cf",
          r, degree, groupSlug: n.groupSlug, entityType: n.entityType, entityId: n.entityId,
          x: (parent?.x ?? W / 2) + (Math.random() - 0.5) * 120,
          y: (parent?.y ?? H / 2) + (Math.random() - 0.5) * 120,
        });
      }
    }
    for (const l of data.links) links.current.add(linkKey(l.source, l.target));
    if (data.truncated) setTruncated(true);
  }, []);

  const relayout = useCallback(() => {
    const ns = [...nodes.current.values()];
    const ls = [...links.current].map(k => { const [source, target] = k.split(" "); return { source, target }; });
    const sim = forceSimulation(ns)
      .force("link", forceLink<GNode, { source: string; target: string }>(ls)
        .id(d => d.id)
        .distance(d => (d.source as unknown as GNode).r + (d.target as unknown as GNode).r + 40).strength(0.4))
      .force("charge", forceManyBody().strength(-520).distanceMax(680))
      .force("center", forceCenter(W / 2, H / 2))
      .force("x", forceX(W / 2).strength(0.035))
      .force("y", forceY(H / 2).strength(0.045))
      .force("collide", forceCollide<GNode>().radius(d => d.r + 14).strength(1))
      .stop();
    for (let i = 0; i < 360; i++) sim.tick();
    setSnap(buildSnapshot());
  }, [buildSnapshot]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    nodes.current.clear(); links.current.clear(); expanded.current.clear(); setTruncated(false);
    getGraphFocus(entityType, 50)
      .then(data => {
        if (cancelled) return;
        if (data.focus) expanded.current.add(data.focus);
        merge(data); relayout(); setLoading(false);
        requestAnimationFrame(() => requestAnimationFrame(fitContent));
      })
      .catch(e => { if (!cancelled) { setError(String(e.message ?? e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [entityType, merge, relayout, fitContent]);

  const expand = useCallback(async (id: string) => {
    if (expanded.current.has(id) || expanding) return;
    setExpanding(id);
    try {
      const data = await getGraphNeighbors(id, 50);
      expanded.current.add(id);
      merge(data, id); relayout();
      requestAnimationFrame(() => requestAnimationFrame(fitContent));
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setExpanding(null); }
  }, [expanding, merge, relayout, fitContent]);

  // 节点拖拽（区分点击/拖动）
  const drag = useRef<{ id: string; sx: number; sy: number; x0: number; y0: number; moved: boolean } | null>(null);
  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const n = nodes.current.get(id); if (!n) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, sx: e.clientX, sy: e.clientY, x0: n.x ?? W / 2, y0: n.y ?? H / 2, moved: false };
  };
  const onNodeMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    const dx = (e.clientX - d.sx) / kRef.current, dy = (e.clientY - d.sy) / kRef.current;
    if (Math.abs(dx) > 3 / kRef.current || Math.abs(dy) > 3 / kRef.current) d.moved = true;
    const n = nodes.current.get(d.id); if (!n) return;
    n.x = d.x0 + dx; n.y = d.y0 + dy;
    setSnap(buildSnapshot());
  };
  const onNodeUp = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (!wasDrag) expand(id);
  };

  if (error) return <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>{error}</div>;
  if (loading) return <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>正在生长关系网络…</div>;
  if (snap.nodes.length === 0) return <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>「{entityType}」暂无标签关系数据</div>;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden touch-none select-none"
      style={{ cursor: "grab" }}
      onWheel={onWheel}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={(e) => { onPointerMove(e); onNodeMove(e); }}
      onPointerUp={onPointerUp}
    >
      {/* 世界层（相机 transform） */}
      <div style={{ position: "absolute", width: W, height: H, transformOrigin: "0 0", transform, willChange: "transform" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {snap.edges.map(e => {
            const mx = (e.ax + e.bx) / 2, my = (e.ay + e.by) / 2;
            const dx = e.bx - e.ax, dy = e.by - e.ay;
            const dim = hovered != null && hovered !== e.aId && hovered !== e.bId;
            return (
              <path key={e.key} vectorEffect="non-scaling-stroke"
                d={`M${e.ax},${e.ay} Q${mx - dy * 0.12},${my + dx * 0.12} ${e.bx},${e.by}`}
                style={{ fill: "none", strokeWidth: 1.3, strokeLinecap: "round",
                  stroke: `color-mix(in srgb, ${e.color} ${dim ? 12 : 38}%, transparent)` }} />
            );
          })}
        </svg>

        {snap.nodes.map(n => {
          // 减少标签重叠：默认只大标签/已展开/hover 显；hover 某节点时隐藏其余标签
          const showLabel = hovered === n.id
            || (hovered == null && n.kind === "tag" && (n.expanded || n.r > 22));
          const dim = hovered != null && hovered !== n.id;
          return (
            <div key={n.id} className="absolute"
              style={{ left: n.x, top: n.y, transform: "translate(-50%,-50%)", zIndex: hovered === n.id ? 6 : 2, opacity: dim ? 0.45 : 1 }}
              onPointerDown={onNodeDown(n.id)}
              onPointerUp={onNodeUp(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(c => (c === n.id ? null : c))}
            >
              {n.kind === "tag" ? (
                <div className="rounded-full" style={{ width: n.r * 2, height: n.r * 2,
                  background: `radial-gradient(circle at 38% 30%, #fff, ${n.color} 60%)`,
                  boxShadow: `0 0 ${n.r * 1.1}px ${n.color}`,
                  border: n.expanded ? `2px solid ${n.color}` : "none", cursor: "pointer" }} />
              ) : (
                <div style={{ width: n.r * 1.5, height: n.r * 1.5, transform: "rotate(45deg)",
                  background: "rgba(241,233,218,.16)", border: "1.5px solid var(--myc-cream)", cursor: "pointer" }} />
              )}
              {showLabel && (
                <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center pointer-events-none" style={{ top: n.r + 4 }}>
                  <div style={{ fontSize: n.r > 22 ? 15 : 12, fontWeight: n.kind === "tag" ? 600 : 500,
                    color: "var(--myc-cream)", textShadow: "0 1px 10px rgba(0,0,0,.75)" }}>
                    {n.label}
                    <span style={{ fontFamily: "var(--font-myc-mono)", fontSize: ".72em", color: "var(--myc-dim)", marginLeft: ".3em" }}>·{n.degree}</span>
                  </div>
                  {n.kind === "entity" && hovered === n.id && (
                    <button className="mt-0.5 text-2xs underline pointer-events-auto" style={{ color: "var(--myc-bio)" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); router.push(`/entities/${n.entityType}/${encodeURIComponent(n.entityId!)}`); }}>
                      查看详情 ↗
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* HUD：图例 + 操作提示 + 重置 */}
      <div className="absolute bottom-3 left-4 flex items-center gap-4 text-2xs pointer-events-none" style={{ color: "var(--myc-dim)" }}>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--myc-bio)" }} />标签</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2" style={{ transform: "rotate(45deg)", border: "1.5px solid var(--myc-cream)" }} />实体</span>
        <span>· 点节点展开 · 拖节点/空白 · 滚轮缩放</span>
        {truncated && <span style={{ color: "var(--myc-amber)" }}>· 邻居超 limit 已截断</span>}
      </div>
      <button
        onClick={() => { setHidePerf(v => !v); requestAnimationFrame(() => setSnap(buildSnapshot())); }}
        className="absolute bottom-3 right-4 px-2.5 py-1 rounded-full text-2xs z-[7]"
        style={{ background: "var(--myc-glass)", border: `1px solid ${hidePerf ? "var(--myc-thread)" : "var(--myc-amber)"}`,
          color: hidePerf ? "var(--myc-dim)" : "var(--myc-amber)", backdropFilter: "blur(8px)" }}
        title="压测标签噪声"
      >
        {hidePerf ? "已隐藏压测数据" : "显示压测数据"}
      </button>
      <button onClick={fitContent} title="自适应居中"
        className="absolute bottom-14 right-4 p-1.5 rounded-md z-[7]"
        style={{ background: "var(--myc-glass)", border: "1px solid var(--myc-thread)", color: "var(--myc-cream)", backdropFilter: "blur(8px)" }}>
        <Maximize2 size={13} />
      </button>
      {expanding && <div className="absolute top-3 left-4 text-2xs pointer-events-none" style={{ color: "var(--myc-dim)" }}>展开中…</div>}
    </div>
  );
}
