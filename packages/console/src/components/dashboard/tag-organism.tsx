"use client";

/**
 * TagOrganism — 数据驱动的「标签有机体」（#109 设计签名母题，design-notes §4）
 *
 * 二部图模型（MEMORY 架构决策）：分组 = 菌核 hub，标签 = 菌体叶，叶连其分组。
 * - 节点大小 ∝ 真实使用量（getTagUsage）
 * - 按分组着色
 * - d3-force 布局，settle 后静态渲染 + CSS 辉光呼吸（不留常驻 rAF，性能友好）
 * - SVG 画菌丝边（复用 .myc-hypha 生长动画）+ HTML 发光节点（复用 .myc-cap）
 *
 * 取代仪表盘的通用饼图/折线，是「有机体即界面」的落地。
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type SimulationNodeDatum,
} from "d3-force";
import { getTagUsage, getTagGroups } from "@/lib/api";

// 虚拟布局坐标空间（节点按 % 定位 → 自适应容器）
const W = 1000;
const H = 700;
const TAG_LIMIT = 56;

// 菌丝调色：分组按哈希取色，bio/lime/amber 暖谱
const GROUP_COLORS = [
  "#6ff5c8", "#c4f85a", "#eaa066", "#5fe3b4", "#a8d96b",
  "#d98a5a", "#8fd9c0", "#e0b87a", "#b0e85a", "#cf9a6a",
];
function colorOf(groupId: string): string {
  let h = 0;
  for (let i = 0; i < groupId.length; i++) h = (h * 31 + groupId.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

type Kind = "hub" | "tag";
interface Node extends SimulationNodeDatum {
  id: string;
  kind: Kind;
  name: string;
  groupId: string;
  color: string;
  r: number;          // 半径（px @ viewBox 比例）
  usage: number;
  glow: number;       // 辉光周期 s
}
interface Link { source: string | Node; target: string | Node; }

interface Settled {
  nodes: (Node & { x: number; y: number })[];
  links: { sx: number; sy: number; tx: number; ty: number; color: string; delay: number }[];
}

export function TagOrganism() {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    (async () => {
      try {
        const [usage, groups] = await Promise.all([
          getTagUsage({ period: "all", order: "desc", limit: TAG_LIMIT }),
          getTagGroups({ pageSize: 100 }),
        ]);
        const tags = usage.items.filter(t => t.usageCount > 0);
        if (tags.length === 0) { setSettled({ nodes: [], links: [] }); return; }

        const groupName = new Map(groups.items.map(g => [g.id, g.name] as const));
        const maxUsage = Math.max(...tags.map(t => t.usageCount));

        // 出现在 top 标签里的分组 → hub 节点
        const usedGroups = new Map<string, { count: number }>();
        for (const t of tags) {
          const e = usedGroups.get(t.groupId) ?? { count: 0 };
          e.count += 1;
          usedGroups.set(t.groupId, e);
        }

        const nodes: Node[] = [];
        for (const [gid, g] of usedGroups) {
          nodes.push({
            id: `g:${gid}`, kind: "hub", name: groupName.get(gid) ?? "?",
            groupId: gid, color: colorOf(gid),
            r: 12 + Math.min(g.count, 10) * 1.1, usage: 0, glow: 3 + Math.random(),
          });
        }
        for (const t of tags) {
          nodes.push({
            id: `t:${t.tagId}`, kind: "tag", name: t.name, groupId: t.groupId,
            color: colorOf(t.groupId),
            r: 5 + Math.sqrt(t.usageCount / maxUsage) * 22,
            usage: t.usageCount, glow: 2.4 + Math.random() * 1.4,
          });
        }
        const links: Link[] = tags.map(t => ({ source: `t:${t.tagId}`, target: `g:${t.groupId}` }));

        const sim = forceSimulation(nodes)
          .force("link", forceLink<Node, Link>(links).id(d => d.id).distance(d => {
            const s = d.source as Node, tg = d.target as Node;
            return s.r + tg.r + 26;
          }).strength(0.5))
          .force("charge", forceManyBody().strength(-170))
          .force("center", forceCenter(W / 2, H / 2))
          .force("collide", forceCollide<Node>().radius(d => d.r + 6).strength(0.9))
          .stop();
        for (let i = 0; i < 320; i++) sim.tick();

        // 夹到画面内、留边距
        const pad = 60;
        for (const n of nodes) {
          n.x = Math.max(pad, Math.min(W - pad, n.x ?? W / 2));
          n.y = Math.max(pad, Math.min(H - pad, n.y ?? H / 2));
        }
        const byId = new Map(nodes.map(n => [n.id, n as Node & { x: number; y: number }]));
        const sLinks = links.map((l, i) => {
          const s = byId.get(l.source as string)!;
          const tg = byId.get(l.target as string)!;
          return { sx: s.x, sy: s.y, tx: tg.x, ty: tg.y, color: s.color, delay: 0.15 + (i % 12) * 0.05 };
        });
        setSettled({ nodes: nodes as (Node & { x: number; y: number })[], links: sLinks });
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    })();
  }, []);

  if (error) {
    return <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>{error}</div>;
  }
  if (!settled) {
    return <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>…</div>;
  }
  if (settled.nodes.length === 0) {
    return <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>暂无标签使用数据</div>;
  }

  const pct = (v: number, max: number) => `${(v / max) * 100}%`;
  const curve = (l: Settled["links"][number]) => {
    const mx = (l.sx + l.tx) / 2, my = (l.sy + l.ty) / 2;
    const dx = l.tx - l.sx, dy = l.ty - l.sy;
    const off = 0.14;
    return `M${l.sx},${l.sy} Q${mx - dy * off},${my + dx * off} ${l.tx},${l.ty}`;
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
        {settled.links.map((l, i) => (
          <path
            key={i}
            className="myc-hypha"
            style={{ animationDelay: `${l.delay}s`, stroke: `color-mix(in srgb, ${l.color} 40%, transparent)` }}
            d={curve(l)}
          />
        ))}
      </svg>
      {settled.nodes.map((n, i) => {
        const showLabel = n.kind === "hub" || n.r > 14 || hovered === n.id;
        return (
          <div
            key={n.id}
            className="myc-knot"
            style={{ left: pct(n.x, W), top: pct(n.y, H), animationDelay: `${0.3 + (i % 14) * 0.04}s`, zIndex: hovered === n.id ? 5 : undefined }}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(cur => (cur === n.id ? null : cur))}
            title={n.kind === "tag" ? `${n.name} · ${n.usage.toLocaleString()}` : n.name}
          >
            <div
              className="myc-cap"
              style={{
                "--s": `${n.r * 1.7}px`,
                "--c": n.color,
                "--t": `${n.glow}s`,
                opacity: n.kind === "hub" ? 0.92 : 1,
                outline: n.kind === "hub" ? `1.5px solid color-mix(in srgb, ${n.color} 60%, transparent)` : undefined,
                outlineOffset: "3px",
              } as CSSProperties}
            />
            {showLabel && (
              <label style={{ fontWeight: n.kind === "hub" ? 700 : 500, fontSize: n.kind === "hub" ? ".9rem" : undefined }}>
                {n.name}
                {n.kind === "tag" && <span className="n"> ·{n.usage >= 1000 ? `${(n.usage / 1000).toFixed(1)}k` : n.usage}</span>}
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
