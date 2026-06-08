"use client";

/**
 * TagOrganism — 数据驱动的「标签有机体」（#109 设计签名母题，design-notes §4）
 *
 * 二部图模型（MEMORY 架构决策）：分组 = 菌核 hub，标签 = 菌体叶，叶连其分组。
 * - 节点大小 ∝ 真实使用量：标签 = 自身用量，hub = 组内入图标签的用量之和（与图例一致）
 * - 按分组着色（groupColor 单一来源，跨页一致）
 * - d3-force 布局，settle 后静态渲染 + CSS 辉光呼吸（不留常驻 rAF，性能友好）
 * - SVG 画菌丝边（复用 .myc-hypha 生长动画）+ HTML 发光节点（复用 .myc-cap）
 *
 * 刷新（reloadToken）：跟随仪表盘自动刷新，但原地平滑更新——节点集合不变时
 * 复用上次坐标、只改大小/数值（CSS 过渡），不重排不跳位；仅标签增删时才重算布局。
 *
 * 响应式：按容器面积分档决定节点/标签数量；渲染时节点像素尺寸随容器缩放，
 * 避免窄屏重叠、宽屏过稀。
 *
 * 下钻：每个节点是 <Link> → /groups/[groupId]（菌核=该分组，标签=其所属分组），
 * 天然可 focus / 回车，兼顾键盘可达与读屏。
 *
 * 取代仪表盘的通用饼图/折线，是「有机体即界面」的落地。
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { getTagUsage } from "@/lib/api";
import { groupColor } from "@/lib/group-color";
import type { OrganismMeta } from "./canvas-config";

// 虚拟布局坐标空间（节点按 % 定位 → 自适应容器）
const W = 1000;
const H = 700;
const FETCH_LIMIT = 200;   // 多拉一些，过滤压测垃圾后仍够数

// 按容器面积分档决定展示数量（避免连续 resize 反复重排）。
type Tier = "s" | "m" | "l";
const TIER_COUNTS: Record<Tier, { tags: number; labels: number }> = {
  s: { tags: 18, labels: 8 },
  m: { tags: 28, labels: 12 },
  l: { tags: 40, labels: 16 },
};
function tierOf(w: number, h: number): Tier {
  const area = w * h;
  if (area < 620_000) return "s";
  if (area < 1_500_000) return "m";
  return "l";
}

// 压测垃圾标签（perf-grp-* / 性能组N）是基建噪声，不应出现在展示型有机体里
const isLoadTestTag = (t: { slug: string; name: string }) =>
  /^perf/i.test(t.slug) || /性能/.test(t.name);

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// 冷热区分（#17）：超过 N 天没用过的标签视为「沉睡」，渲染时暗淡。
const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 86_400_000;
const isStaleTag = (lastUsedAt: string | null) =>
  !lastUsedAt || Date.now() - new Date(lastUsedAt).getTime() > STALE_MS;

type Kind = "hub" | "tag";
interface Node extends SimulationNodeDatum {
  id: string;
  kind: Kind;
  name: string;
  groupId: string;
  color: string;
  r: number;          // 半径（viewBox 单位；渲染时再乘容器缩放 k）
  usage: number;      // 标签=自身用量；hub=组内入图标签用量之和
  glow: number;       // 辉光周期 s
  top?: boolean;      // 是否常显标签（分组 hub + 高频标签）
  stale?: boolean;    // 久未使用（暗淡显示）
}
interface GraphLink { source: string | Node; target: string | Node; }

interface LegendItem { id: string; name: string; color: string; count: number }

interface Settled {
  nodes: (Node & { x: number; y: number })[];
  links: { sx: number; sy: number; tx: number; ty: number; color: string; delay: number }[];
  legend: LegendItem[];
  shown: number;       // 入图标签数
  total: number;       // 过滤后真实标签总数（slice 前）
  usageMin: number;
  usageMax: number;
  hasStale: boolean;   // 是否有沉睡标签（决定图例是否提示）
}

// LOD 阈值：相机缩放低于此值 → 收起标签叶/菌丝/标签 label，只留分组 hub（远观「森林」）；
// 高于此 → 展开到单个标签（近看「树木」）。语义缩放，非几何——纯渲染开关，不重算布局。
const LOD_DETAIL = 0.85;

export function TagOrganism({ reloadToken = 0, onMeta, zoom = 1 }: { reloadToken?: number; onMeta?: (m: OrganismMeta | null) => void; zoom?: number }) {
  const t = useTranslations("dashboard");
  // 是否展开到标签层级（近看）；低于阈值只显示分组 hub（远观）
  const detail = zoom >= LOD_DETAIL;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [settled, setSettled] = useState<Settled | null>(null);
  const [errored, setErrored] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  // 上次 settle 后的坐标，按 id 缓存 → 刷新时复用，保持布局稳定不跳
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // onMeta 用 ref 持有，避免把它放进数据 effect 依赖里导致每次渲染都重抓
  const onMetaRef = useRef(onMeta);
  useEffect(() => { onMetaRef.current = onMeta; }, [onMeta]);

  // ── 容器尺寸跟踪（驱动节点缩放 k + 数量分档 tier）────────────────
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 标签页隐藏时暂停动画，后台不烧 GPU ─────────────────────────
  useEffect(() => {
    const onVis = () => rootRef.current?.classList.toggle("myc-paused", document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const tier = tierOf(size.w, size.h);

  // ── 数据 + 布局：reloadToken 或 tier 变化时重算（resize 同档不重算）──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { tags: TAG_LIMIT, labels: LABEL_TOP } = TIER_COUNTS[tier];
        const usage = await getTagUsage({ period: "all", order: "desc", limit: FETCH_LIMIT });
        if (cancelled) return;

        // 过滤压测垃圾 + 零使用，再取 top-N 真实标签
        const real = usage.items.filter((it) => it.usageCount > 0 && !isLoadTestTag(it));
        const total = real.length;
        const tags = real.slice(0, TAG_LIMIT);
        if (tags.length === 0) {
          setSettled({ nodes: [], links: [], legend: [], shown: 0, total: 0, usageMin: 0, usageMax: 0, hasStale: false });
          setErrored(false);
          onMetaRef.current?.(null);
          return;
        }

        // 分组名直接取自 usage 项（自带 groupName），无需另拉 getTagGroups
        const groupName = new Map<string, string>();
        for (const it of real) if (!groupName.has(it.groupId)) groupName.set(it.groupId, it.groupName);

        const maxUsage = Math.max(...tags.map((t) => t.usageCount));
        const usageMin = Math.min(...tags.map((t) => t.usageCount));
        // 仅当后端确实回填了 lastUsedAt 才启用冷热区分，否则整图全灰反而像坏了
        const anyDated = tags.some((t) => !!t.lastUsedAt);

        // 组内入图标签的用量之和 → hub 大小（与「大小=使用量」图例一致）
        const usedGroups = new Map<string, { count: number; sum: number }>();
        for (const tg of tags) {
          const e = usedGroups.get(tg.groupId) ?? { count: 0, sum: 0 };
          e.count += 1;
          e.sum += tg.usageCount;
          usedGroups.set(tg.groupId, e);
        }
        const maxGroupSum = Math.max(...[...usedGroups.values()].map((g) => g.sum));

        const nodes: Node[] = [];
        for (const [gid, g] of usedGroups) {
          nodes.push({
            id: `g:${gid}`, kind: "hub", name: groupName.get(gid) ?? "?",
            groupId: gid, color: groupColor(gid),
            r: 14 + Math.sqrt(g.sum / maxGroupSum) * 20,   // ∝ 聚合用量
            usage: g.sum, glow: 3 + Math.random(),
          });
        }
        tags.forEach((tg, idx) => {
          nodes.push({
            id: `t:${tg.tagId}`, kind: "tag", name: tg.name, groupId: tg.groupId,
            color: groupColor(tg.groupId),
            r: 6 + Math.sqrt(tg.usageCount / maxUsage) * 24,
            usage: tg.usageCount, glow: 2.4 + Math.random() * 1.4,
            top: idx < LABEL_TOP,
            stale: anyDated && isStaleTag(tg.lastUsedAt),
          });
        });
        const links: GraphLink[] = tags.map((tg) => ({ source: `t:${tg.tagId}`, target: `g:${tg.groupId}` }));

        // 用上次坐标 seed → 刷新/换档时布局稳定
        const prev = posRef.current;
        let reused = 0;
        for (const n of nodes) {
          const p = prev.get(n.id);
          if (p) { n.x = p.x; n.y = p.y; reused++; }
          else { n.x = W / 2 + (Math.random() - 0.5) * 80; n.y = H / 2 + (Math.random() - 0.5) * 80; }
        }
        const sameSet = reused === nodes.length && prev.size === nodes.length;

        if (sameSet) {
          // 节点集合不变：跳过力模拟，仅把 link 端点解析为节点对象引用
          const byId = new Map(nodes.map((n) => [n.id, n] as const));
          for (const l of links) {
            l.source = byId.get(l.source as string)!;
            l.target = byId.get(l.target as string)!;
          }
        } else {
          const sim = forceSimulation(nodes)
            .force("link", forceLink<Node, GraphLink>(links).id((d) => d.id).distance((d) => {
              const s = d.source as Node, tg = d.target as Node;
              return s.r + tg.r + 30;
            }).strength(0.5))
            // 更强排斥 + 更大碰撞间距 → 拉开中心密集区，给标签留出可读空隙（#125）
            .force("charge", forceManyBody().strength(-205))
            .force("center", forceCenter(W / 2, H / 2))
            .force("x", forceX(W / 2).strength(0.045))
            .force("y", forceY(H / 2).strength(0.065))
            .force("collide", forceCollide<Node>().radius((d) => d.r + 11).strength(0.95))
            .alpha(prev.size === 0 ? 1 : 0.4)   // 已有布局时温和收敛，少跳
            .stop();
          const ticks = prev.size === 0 ? 320 : 120;
          for (let i = 0; i < ticks; i++) sim.tick();
        }

        // 夹到画面内、留边距
        const pad = 60;
        for (const n of nodes) {
          n.x = Math.max(pad, Math.min(W - pad, n.x ?? W / 2));
          n.y = Math.max(pad, Math.min(H - pad, n.y ?? H / 2));
        }
        // 写回坐标缓存
        const nextPos = new Map<string, { x: number; y: number }>();
        for (const n of nodes) nextPos.set(n.id, { x: n.x!, y: n.y! });
        posRef.current = nextPos;

        const sLinks = links.map((l, i) => {
          const s = l.source as Node & { x: number; y: number };
          const tg = l.target as Node & { x: number; y: number };
          return { sx: s.x, sy: s.y, tx: tg.x, ty: tg.y, color: s.color, delay: 0.15 + (i % 12) * 0.05 };
        });
        const legend: LegendItem[] = [...usedGroups.entries()]
          .map(([gid, g]) => ({ id: gid, name: groupName.get(gid) ?? "?", color: groupColor(gid), count: g.count }))
          .sort((a, b) => b.count - a.count);

        if (cancelled) return;
        const hasStale = nodes.some((n) => n.stale);
        setSettled({
          nodes: nodes as (Node & { x: number; y: number })[],
          links: sLinks, legend,
          shown: tags.length, total, usageMin, usageMax: maxUsage,
          hasStale,
        });
        setErrored(false);
        // 向上抛出图例元信息，供「图谱图例」widget 消费（与背景显示一致）
        onMetaRef.current?.({
          legend, shown: tags.length, total, usageMin, usageMax: maxUsage,
          hasStale, staleDays: STALE_DAYS,
        });
      } catch (e) {
        console.error("TagOrganism load failed", e);
        if (!cancelled) { setErrored(true); onMetaRef.current?.(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadToken, tier]);

  // 渲染缩放：节点像素尺寸随容器走（与碰撞间距成比例，消除重叠/过稀）
  const k = Math.min(size.w / W, size.h / H) || 1;
  const pct = (v: number, max: number) => `${(v / max) * 100}%`;
  const curve = (l: Settled["links"][number]) => {
    const mx = (l.sx + l.tx) / 2, my = (l.sy + l.ty) / 2;
    const dx = l.tx - l.sx, dy = l.ty - l.sy;
    const off = 0.14;
    return `M${l.sx},${l.sy} Q${mx - dy * off},${my + dx * off} ${l.tx},${l.ty}`;
  };

  const centered = (text: string) => (
    <div className="grid place-items-center h-full text-sm" style={{ color: "var(--myc-dim)" }}>{text}</div>
  );

  return (
    <div ref={rootRef} className="relative w-full h-full overflow-hidden">
      {errored ? centered(t("organismError"))
        : !settled ? centered(t("organismLoading"))
        : settled.nodes.length === 0 ? centered(t("organismEmpty"))
        : (
        <>
          {/* preserveAspectRatio=none：viewBox 直接拉伸填满容器，与 HTML 节点的
              百分比定位用同一坐标系（slice 会等比裁剪导致边与节点错位） */}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
            {detail && settled.links.map((l, i) => (
              <path
                key={i}
                className="myc-hypha"
                vectorEffect="non-scaling-stroke"
                style={{ animationDelay: `${l.delay}s`, stroke: `color-mix(in srgb, ${l.color} 40%, transparent)` }}
                d={curve(l)}
              />
            ))}
          </svg>

          {/* 层 1：发光气泡（可交互、可下钻、承载 hover）。先画，永远在标签之下。 */}
          {settled.nodes.map((n, i) => {
            if (n.kind === "tag" && !detail) return null;   // LOD：远观（低缩放）收起标签叶，只留分组 hub
            return (
            <Link
              key={n.id}
              href={`/groups/${n.groupId}`}
              prefetch={false}
              className="myc-cap-pos myc-cap-link"
              style={{ left: pct(n.x, W), top: pct(n.y, H), animationDelay: `${0.3 + (i % 14) * 0.04}s`, zIndex: hovered === n.id ? 6 : undefined }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered((cur) => (cur === n.id ? null : cur))}
              aria-label={n.kind === "tag" ? `${n.name} · ${n.usage.toLocaleString()}` : n.name}
              title={n.kind === "tag" ? `${n.name} · ${n.usage.toLocaleString()}` : n.name}
            >
              <div
                className="myc-cap"
                style={{
                  "--s": `${n.r * 1.9 * k}px`,
                  "--c": n.color,
                  "--t": `${n.glow}s`,
                  opacity: n.kind === "hub" ? 0.92 : 1,
                  // 沉睡标签：去饱和 + 压暗（filter 不被呼吸/绽放动画覆盖，跨主题稳定）
                  filter: n.stale ? "grayscale(.6) brightness(.62)" : undefined,
                  outline: n.kind === "hub" ? `1.5px solid color-mix(in srgb, ${n.color} 60%, transparent)` : undefined,
                  outlineOffset: "3px",
                } as CSSProperties}
              />
            </Link>
            );
          })}

          {/* 层 2：标签（pill 背板）。整体置于所有气泡之上，永不被气泡/辉光遮挡（#125）。
              只渲染常显（hub + 高频）或当前 hover 的节点；pointer-events:none 不挡气泡 hover。 */}
          {settled.nodes.map((n) => {
            // 远观（低缩放）只显示分组 hub 的名字，标签 label 全收起
            const showLabel = n.kind === "hub" || (detail && (n.top === true || hovered === n.id));
            if (!showLabel) return null;
            const capR = n.r * 0.95 * k;          // 渲染态气泡半径
            return (
              <div
                key={n.id}
                className="myc-label-pos"
                style={{
                  left: pct(n.x, W), top: pct(n.y, H),
                  transform: `translate(-50%, ${(capR + 6).toFixed(1)}px)`,
                  zIndex: hovered === n.id ? 7 : undefined,
                }}
              >
                <span className="myc-label" data-hub={n.kind === "hub" || undefined}>
                  {n.name}
                  {n.kind === "tag" && <span className="n">·{compact(n.usage)}</span>}
                </span>
              </div>
            );
          })}
          {/* 图例已抽出为独立的「图谱图例」widget（通过 onMeta 抛出元信息）。 */}
        </>
      )}
    </div>
  );
}
