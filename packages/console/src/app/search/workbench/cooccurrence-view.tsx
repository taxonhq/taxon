"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Network } from "lucide-react";
import { searchCooccurrence, type BoolExpr, type CooccurrenceResult } from "@/lib/api";
import { cn } from "@/lib/utils";

type ColorBy = "lift" | "count";

interface CooccurrenceViewProps {
  entityType: string;
  filter:     BoolExpr | undefined;
  topN?:      number;
}

export function CooccurrenceView({ entityType, filter, topN = 15 }: CooccurrenceViewProps) {
  const t = useTranslations("search");
  const [data, setData] = useState<CooccurrenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorBy, setColorBy] = useState<ColorBy>("lift");

  useEffect(() => {
    if (!entityType) return;
    setLoading(true);
    setError(null);
    searchCooccurrence({ entityType, filter, topN })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [entityType, filter, topN]);

  // 计算 colorBy 维度下的最大值（用于色阶归一化）
  const maxValue = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const v of Object.values(data.cooccurrence)) {
      const val = colorBy === "lift" ? v.lift : v.count;
      if (val > m) m = val;
    }
    return m;
  }, [data, colorBy]);

  if (!entityType) return null;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-sub gap-2">
        <Loader2 className="size-4 animate-spin" /> {t("coCalculating")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">{error}</div>
    );
  }

  if (!data || data.tags.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-card p-12 text-center text-ink-sub flex flex-col items-center gap-3">
        <Network className="size-7 opacity-50" />
        <span>{t("coEmpty")}</span>
      </div>
    );
  }

  const tags = data.tags;
  const cellOf = (i: number, j: number) => {
    const a = tags[i].tagId;
    const b = tags[j].tagId;
    if (a === b) return null;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    return data.cooccurrence[key];
  };

  return (
    <div className="space-y-4">
      {/* 顶部统计 + 配色切换 */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-6 text-base">
          <span><span className="text-ink-sub">{t("coParticipating")}</span> <strong className="text-ink">{tags.length}</strong></span>
          <span><span className="text-ink-sub">{t("coNonzero")}</span> <strong className="text-ink">{Object.keys(data.cooccurrence).length}</strong></span>
          <span><span className="text-ink-sub">{t("coSubsetTotal")}</span> <strong className="text-ink">{data.totalEntities}</strong></span>
        </div>
        <div className="inline-flex rounded-md border border-edge overflow-hidden">
          {(["lift", "count"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setColorBy(m)}
              className={cn(
                "px-3 py-1.5 text-sm transition-colors",
                colorBy === m ? "bg-ink text-surface" : "text-ink hover:bg-row-hover",
              )}
            >
              {m === "lift" ? t("coColorLift") : t("coColorCount")}
            </button>
          ))}
        </div>
      </div>

      {/* 矩阵 */}
      <div className="rounded-lg border border-edge bg-card overflow-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-row-head text-xs font-semibold text-ink-sub px-3 py-2 border-b border-r border-edge min-w-[140px] text-left">
                <span className="text-ink-sub">↘</span>
              </th>
              {tags.map((tag) => (
                <th
                  key={tag.tagId}
                  className="text-xs font-medium text-ink px-2 py-2 border-b border-edge whitespace-nowrap"
                  title={t("coColTip", { group: tag.groupName, name: tag.name, count: tag.total })}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="max-w-[80px] truncate">{tag.name}</span>
                    <span className="text-ink-faint text-2xs">{tag.total}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tags.map((rowTag, i) => (
              <tr key={rowTag.tagId} className="hover:bg-row-hover">
                <th className="sticky left-0 z-10 bg-row-head text-left text-xs font-medium text-ink px-3 py-2 border-r border-edge whitespace-nowrap">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate max-w-[120px]" title={`${rowTag.groupName} · ${rowTag.name}`}>
                      {rowTag.name}
                    </span>
                    <span className="text-ink-faint text-2xs">{rowTag.total}</span>
                  </div>
                </th>
                {tags.map((colTag, j) => {
                  // 对角线：显示该 tag 自身的 total（粗体）
                  if (i === j) {
                    return (
                      <td
                        key={colTag.tagId}
                        className="text-center text-sm font-bold border border-edge/30 px-2 py-2 bg-overlay/30"
                        title={t("coDiagTip", { name: rowTag.name, count: rowTag.total })}
                      >
                        {rowTag.total}
                      </td>
                    );
                  }
                  const cell = cellOf(i, j);
                  return (
                    <CooccurrenceCell
                      key={colTag.tagId}
                      cell={cell}
                      colorBy={colorBy}
                      max={maxValue}
                      rowName={rowTag.name}
                      colName={colTag.name}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 图例 + 说明 */}
      <div className="space-y-2">
        <Legend max={maxValue} colorBy={colorBy} />
        <p className="text-xs text-ink-faint leading-relaxed">
          {colorBy === "lift" ? (
            <>
              <strong>Lift</strong>{t("coLiftFormula")}
              <span className="text-ok ml-1">&gt; 1</span> {t("coLiftPos")}
              <span className="text-ink-sub ml-1">≈ 1</span> {t("coLiftIndep")}
              <span className="text-bad ml-1">&lt; 1</span> {t("coLiftNeg")}
            </>
          ) : (
            <>
              <strong>Count</strong>{t("coCountDesc")}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function CooccurrenceCell({
  cell, colorBy, max, rowName, colName,
}: {
  cell: { count: number; lift: number } | null | undefined;
  colorBy: ColorBy;
  max: number;
  rowName: string;
  colName: string;
}) {
  if (!cell || cell.count === 0) {
    return (
      <td
        className="text-center text-ink-faint text-base border border-edge/30 px-2 py-2 min-w-[56px]"
        title={`${rowName} ↔ ${colName}: 0`}
      >
        ·
      </td>
    );
  }

  // 色阶：lift 用红 / 蓝双色（< 1 红 / >= 1 蓝）；count 单色蓝
  let bg = "transparent";
  if (colorBy === "lift") {
    if (cell.lift >= 1) {
      const r = max > 1 ? (cell.lift - 1) / (max - 1) : 0;
      bg = `oklch(0.62 0.18 250 / ${0.1 + r * 0.5})`;
    } else {
      const r = 1 - cell.lift;
      bg = `oklch(0.62 0.18 28 / ${0.1 + r * 0.4})`;
    }
  } else {
    const r = max > 0 ? Math.log(cell.count + 1) / Math.log(max + 1) : 0;
    bg = `oklch(0.62 0.18 250 / ${0.08 + r * 0.55})`;
  }

  const display = colorBy === "lift" ? cell.lift.toFixed(2) : String(cell.count);
  const tooltip = `${rowName} ↔ ${colName}\ncount=${cell.count}, lift=${cell.lift.toFixed(2)}`;
  return (
    <td
      className="text-center text-sm font-medium border border-edge/30 px-2 py-2 min-w-[56px] transition-all hover:outline hover:outline-2 hover:outline-ink"
      style={{ background: bg }}
      title={tooltip}
    >
      {display}
    </td>
  );
}

function Legend({ max, colorBy }: { max: number; colorBy: ColorBy }) {
  const t = useTranslations("search");
  if (colorBy === "count") {
    if (max === 0) return null;
    const stops = [0, 0.25, 0.5, 0.75, 1];
    return (
      <div className="flex items-center gap-3 text-xs text-ink-sub">
        <span>{t("pvLegendLess")}</span>
        <div className="flex">
          {stops.map((s) => (
            <div
              key={s}
              className="w-8 h-3 border border-edge/30"
              style={{ background: `oklch(0.62 0.18 250 / ${0.08 + s * 0.55})` }}
            />
          ))}
        </div>
        <span>{t("pvLegendMore")}</span>
        <span className="ml-2 text-ink-faint">{t("coLegendPeak", { max })}</span>
      </div>
    );
  }
  // lift: 红 → 中性 → 蓝
  return (
    <div className="flex items-center gap-3 text-xs text-ink-sub">
      <span>{t("coLegendNeg")}</span>
      <div className="flex">
        {[1, 0.6, 0.2].map((r, i) => (
          <div
            key={`neg-${i}`}
            className="w-8 h-3 border border-edge/30"
            style={{ background: `oklch(0.62 0.18 28 / ${0.1 + r * 0.4})` }}
          />
        ))}
        <div className="w-8 h-3 border border-edge/30" />
        {[0.2, 0.6, 1].map((r, i) => (
          <div
            key={`pos-${i}`}
            className="w-8 h-3 border border-edge/30"
            style={{ background: `oklch(0.62 0.18 250 / ${0.1 + r * 0.5})` }}
          />
        ))}
      </div>
      <span>{t("coLegendPos")}</span>
      <span className="ml-2 text-ink-faint">{t("coLegendPeakLift", { max: max.toFixed(2) })}</span>
    </div>
  );
}
