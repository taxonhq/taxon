"use client";

/**
 * TagGalaxy — 标签星系宏观视图（#101 WebGL 渲染）。
 *
 * 节点 = 标签（按 TagGroup 着色，大小 ∝ √entityCount）。
 * 边   = 标签共现强度（粗细 ∝ log(weight)）。
 * 渲染引擎：sigma.js WebGL（graphology 数据层 + d3-force 布局）。
 *
 * 交互：hover → 高亮直连邻居；click → onDrillDown（下钻到实体局部图）。
 */

import { useEffect, useRef } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type SimulationNodeDatum,
} from "d3-force";
import { groupColor } from "@/lib/group-color";
import type { GraphAggregateData } from "@/lib/api";

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  size: number;
}

// hover 状态存 closure ref，避免触发 React 重渲
interface GalaxyState { hoveredNode: string | null }

export function TagGalaxy({
  data,
  onDrillDown,
}: {
  data: GraphAggregateData;
  onDrillDown?: (nodeId: string) => void;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const onDrillRef    = useRef(onDrillDown);
  useEffect(() => { onDrillRef.current = onDrillDown; }, [onDrillDown]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data.nodes.length) return;

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sigmaInst: { kill(): void; refresh(): void; on(e: string, h: (payload: any) => void): void; setSetting(k: string, v: unknown): void } | null = null;

    (async () => {
      const [{ default: Sigma }, { default: Graph }] = await Promise.all([
        import("sigma"),
        import("graphology"),
      ]);
      if (cancelled || !containerRef.current) return;

      // ── 1. 布局：d3-force（同步 300 ticks）──────────────────────────
      const layoutNodes: LayoutNode[] = data.nodes.map(n => ({
        id:   n.id,
        size: Math.max(5, Math.min(22, 5 + Math.sqrt(n.entityCount) * 0.75)),
      }));
      const byId = new Map(layoutNodes.map(n => [n.id, n]));
      const layoutLinks = data.links.map(l => ({ source: l.source, target: l.target }));

      const sim = forceSimulation(layoutNodes)
        .force("link",    forceLink<LayoutNode, { source: string; target: string }>(layoutLinks)
                            .id(d => d.id).distance(70).strength(0.35))
        .force("charge",  forceManyBody().strength(-130).distanceMax(400))
        .force("center",  forceCenter(0, 0))
        .force("collide", forceCollide<LayoutNode>().radius(d => d.size + 10).strength(0.8))
        .stop();
      for (let i = 0; i < 320; i++) sim.tick();

      // ── 2. 构建 graphology 图 ──────────────────────────────────────
      const graph = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });

      for (const n of data.nodes) {
        const ln = byId.get(n.id);
        graph.addNode(n.id, {
          x:     ln?.x ?? 0,
          y:     -(ln?.y ?? 0), // sigma Y 轴朝上，d3 朝下
          size:  ln?.size ?? 8,
          label: n.label,
          color: groupColor(n.groupSlug || n.groupId || n.id),
        });
      }
      for (const l of data.links) {
        if (!graph.hasNode(l.source) || !graph.hasNode(l.target)) continue;
        if (!graph.hasEdge(l.source, l.target)) {
          graph.addEdge(l.source, l.target, {
            size:  Math.max(0.6, Math.min(4, 0.6 + Math.log(l.weight + 1) * 0.7)),
            color: "rgba(191,163,125,0.18)",
          });
        }
      }

      // ── 3. Sigma WebGL 渲染 ────────────────────────────────────────
      const state: GalaxyState = { hoveredNode: null };

      const sigma = new Sigma(graph, containerRef.current!, {
        renderEdgeLabels:  false,
        labelDensity:      0.12,
        labelFont:         "monospace",
        labelSize:         12,
        labelWeight:       "600",
        labelColor:        { color: "#efe4cf" },
        defaultEdgeColor:  "rgba(191,163,125,0.18)",
        defaultNodeColor:  "#a67c52",
        // 背景透明（父容器 CSS 控制背景）
        // hover 高亮：nodeReducer + edgeReducer
        nodeReducer: (node: string, data: Record<string, unknown>) => {
          if (state.hoveredNode && node !== state.hoveredNode) {
            const connected = graph.neighbors(state.hoveredNode).includes(node);
            if (!connected) return { ...data, color: "rgba(100,90,75,0.3)", label: null, size: (data.size as number) * 0.55 };
          }
          return data;
        },
        edgeReducer: (edge: string, data: Record<string, unknown>) => {
          if (state.hoveredNode) {
            const [s, t] = graph.extremities(edge);
            if (s !== state.hoveredNode && t !== state.hoveredNode) {
              return { ...data, color: "rgba(100,90,75,0.06)" };
            }
            return { ...data, color: "rgba(191,163,125,0.55)", size: (data.size as number) * 2 };
          }
          return data;
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      sigma.on("enterNode", ({ node }: { node: string }) => {
        state.hoveredNode = node;
        sigma.refresh();
      });
      sigma.on("leaveNode", () => {
        state.hoveredNode = null;
        sigma.refresh();
      });
      sigma.on("clickNode", ({ node }: { node: string }) => {
        onDrillRef.current?.(node);
      });

      sigmaInst = sigma;
    })();

    return () => {
      cancelled = true;
      sigmaInst?.kill();
    };
  // data 变化整体重建
  }, [data]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    />
  );
}
