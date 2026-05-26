"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, CalendarRange } from "lucide-react";
import {
  searchEntities, type BoolExpr, type RegisteredEntity,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Granularity = "day" | "week" | "month";
type Field = "registeredAt" | "taggedAt";

interface TimelineViewProps {
  entityType: string;
  filter:     BoolExpr | undefined;
}

interface BucketRow {
  /** YYYY-MM-DD / YYYY-Www / YYYY-MM */
  key:    string;
  /** Date 用于排序 */
  date:   Date;
  manual: number;
  ai:     number;
  system: number;
  import: number;
  total:  number;
}

// ── 桶计算 ──────────────────────────────────────────────────────────────
function startOfWeek(d: Date): Date {
  // ISO 周（周一为起点）
  const day = d.getUTCDay() || 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - day + 1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function bucketKey(d: Date, g: Granularity): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (g === "day") return `${y}-${m}-${day}`;
  if (g === "month") return `${y}-${m}`;
  // week: ISO week number
  const target = new Date(d);
  target.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() || 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  const weekNo = 1 + Math.round((diff - 3 + (firstThursday.getUTCDay() || 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function bucketStart(d: Date, g: Granularity): Date {
  if (g === "day") {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  }
  if (g === "month") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  return startOfWeek(d);
}

// 智能选粒度：按时间跨度
function chooseGranularity(items: RegisteredEntity[], field: Field): Granularity {
  if (items.length === 0) return "day";
  const dates = items.map(i => {
    if (field === "registeredAt") return new Date(i.registeredAt).getTime();
    const t = i.tags?.[0]?.taggedAt;
    return t ? new Date(t).getTime() : new Date(i.registeredAt).getTime();
  });
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const days = (max - min) / 86400000;
  if (days <= 31)  return "day";
  if (days <= 180) return "week";
  return "month";
}

export function TimelineView({ entityType, filter }: TimelineViewProps) {
  const [field, setField] = useState<Field>("registeredAt");
  const [granularity, setGranularity] = useState<Granularity | "auto">("auto");
  const [items, setItems] = useState<RegisteredEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityType) return;
    setLoading(true);
    setError(null);
    searchEntities({
      entityType, filter,
      pageSize: 500,  // 时间线需要尽可能多的样本；超过 500 时显示警告
      include: ["tags"],  // 需要 tags 拿 taggedAt 和 source
    })
      .then(r => { setItems(r.items); setTotal(r.total); })
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [entityType, filter]);

  // 决定实际粒度
  const actualGran: Granularity = useMemo(() => {
    if (granularity !== "auto") return granularity;
    return chooseGranularity(items, field);
  }, [granularity, items, field]);

  // 聚合到 bucket
  const buckets = useMemo<BucketRow[]>(() => {
    if (items.length === 0) return [];
    const map = new Map<string, BucketRow>();
    for (const item of items) {
      // 对每个实体：用其 registeredAt 或最后一次 taggedAt
      let dateStr: string;
      let source: "manual" | "ai" | "system" | "import" = "manual";
      if (field === "registeredAt") {
        dateStr = item.registeredAt;
        // 取所有 tag 中第一个 active 的 source 作为代表
        const firstTag = item.tags?.find(t => t.status === "active");
        if (firstTag) source = (firstTag.source as typeof source) ?? "manual";
      } else {
        // 用最近的 taggedAt
        const sorted = (item.tags ?? []).slice().sort((a, b) =>
          new Date(b.taggedAt).getTime() - new Date(a.taggedAt).getTime()
        );
        if (!sorted[0]) continue;
        dateStr = sorted[0].taggedAt;
        source = (sorted[0].source as typeof source) ?? "manual";
      }
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      const key = bucketKey(d, actualGran);
      let row = map.get(key);
      if (!row) {
        row = { key, date: bucketStart(d, actualGran), manual: 0, ai: 0, system: 0, import: 0, total: 0 };
        map.set(key, row);
      }
      row[source] = (row[source] || 0) + 1;
      row.total += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [items, field, actualGran]);

  const maxBucket = useMemo(
    () => buckets.reduce((m, b) => Math.max(m, b.total), 0),
    [buckets],
  );

  const grandStats = useMemo(() => {
    const s = { manual: 0, ai: 0, system: 0, import: 0 };
    for (const b of buckets) {
      s.manual += b.manual;
      s.ai     += b.ai;
      s.system += b.system;
      s.import += b.import;
    }
    return s;
  }, [buckets]);

  if (!entityType) return null;

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-sub gap-2">
        <Loader2 className="size-4 animate-spin" /> 加载时间线数据中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">{error}</div>
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-card p-12 text-center text-ink-sub flex flex-col items-center gap-3">
        <CalendarRange className="size-7 opacity-50" />
        <span>无可视化的时间数据</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 控件 */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-md border border-edge overflow-hidden">
            {(["registeredAt", "taggedAt"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setField(f)}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  field === f ? "bg-ink text-surface" : "text-ink hover:bg-row-hover",
                )}
              >
                {f === "registeredAt" ? "按注册时间" : "按打标时间"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-md border border-edge overflow-hidden">
            {(["auto", "day", "week", "month"] as const).map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  granularity === g ? "bg-ink text-surface" : "text-ink hover:bg-row-hover",
                )}
              >
                {g === "auto" ? `自动 (${actualGran})` : { day: "日", week: "周", month: "月" }[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 text-base">
          <span className="text-ink-sub">样本</span>
          <strong className="text-ink">{items.length}</strong>
          {total > items.length && (
            <span className="text-xs text-bad">⚠️ 截断（实际 {total}，仅取前 500 计算时间线）</span>
          )}
        </div>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          { key: "manual", label: "人工",   color: SRC_COLORS.manual, count: grandStats.manual },
          { key: "ai",     label: "AI",     color: SRC_COLORS.ai,     count: grandStats.ai },
          { key: "system", label: "系统",   color: SRC_COLORS.system, count: grandStats.system },
          { key: "import", label: "导入",   color: SRC_COLORS.import, count: grandStats.import },
        ].map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: s.color }} />
            <span className="text-ink">{s.label}</span>
            <span className="text-ink-faint">{s.count}</span>
          </div>
        ))}
      </div>

      {/* 时间线柱状图（堆叠） */}
      <div className="rounded-lg border border-edge bg-card p-4 overflow-auto">
        <div className="flex items-end gap-1 h-64 min-w-fit">
          {buckets.map(b => {
            const h = (b.total / maxBucket) * 100;
            return (
              <div key={b.key} className="flex flex-col items-center gap-1.5 group" style={{ minWidth: 28 }}>
                <span className="text-2xs text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity">
                  {b.total}
                </span>
                <div
                  className="w-7 flex flex-col-reverse rounded-t overflow-hidden border border-edge/30 transition-all hover:outline hover:outline-2 hover:outline-ink"
                  style={{ height: `${h}%` }}
                  title={`${b.key}\n人工 ${b.manual} · AI ${b.ai} · 系统 ${b.system} · 导入 ${b.import}\n总计 ${b.total}`}
                >
                  {([
                    ["manual", b.manual],
                    ["ai",     b.ai],
                    ["system", b.system],
                    ["import", b.import],
                  ] as const).map(([src, cnt]) => {
                    if (cnt === 0) return null;
                    const segH = (cnt / b.total) * 100;
                    return (
                      <div
                        key={src}
                        style={{ height: `${segH}%`, background: SRC_COLORS[src] }}
                      />
                    );
                  })}
                </div>
                <span className="text-2xs text-ink-sub rotate-45 origin-top-left whitespace-nowrap" style={{ width: 20 }}>
                  {b.key}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        {field === "registeredAt"
          ? "按实体注册时间分桶；source 颜色取自该实体首个 active 标签。"
          : "按最后打标时间分桶；source 颜色取自最近的 active 标签。"}
        {" "}时间线为客户端聚合（最多 500 个样本），如需精确大规模统计请后续接入专用 timeline endpoint。
      </p>
    </div>
  );
}

const SRC_COLORS = {
  manual: "oklch(0.65 0.16 250)", // 蓝
  ai:     "oklch(0.7  0.18 145)", // 绿
  system: "oklch(0.65 0.14 300)", // 紫
  import: "oklch(0.7  0.16 60)",  // 橙
} as const;
