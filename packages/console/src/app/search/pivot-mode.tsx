"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, ArrowRight, Layers, Filter, ChevronDown, X, MoveDown } from "lucide-react";
import {
  getEntityTypes, getTagGroups, searchPivot, getGroupTags,
  type PivotResult, type BoolExpr, type SearchEntitiesRequest,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── 过滤状态类型 ────────────────────────────────────────────────────────────
type SrcChoice = "manual" | "ai" | "system" | "import";
type StatusChoice = "active" | "pending" | "rejected";
interface FilterState {
  sources:    SrcChoice[];     // 来源（OR within group），空数组=不过滤
  statuses:   StatusChoice[];  // 状态（OR within group），默认 [active]
  confidence: { gte?: number; lte?: number };  // 置信度区间
}

const EMPTY_FILTER: FilterState = { sources: [], statuses: [], confidence: {} };

function buildFilterExpr(f: FilterState): BoolExpr | undefined {
  const leaves: BoolExpr[] = [];
  if (f.sources.length > 0)  leaves.push({ source: f.sources });
  if (f.statuses.length > 0) leaves.push({ status: f.statuses });
  if (f.confidence.gte !== undefined || f.confidence.lte !== undefined) {
    leaves.push({ confidence: f.confidence });
  }
  if (leaves.length === 0) return undefined;
  if (leaves.length === 1) return leaves[0];
  return { and: leaves };
}

// 下钻拼接：将「行 tag AND 列 tag AND 当前过滤」合成完整 BoolExpr
function buildDrillExpr(
  rowTagId: string,
  colTagId: string,
  currentFilter: BoolExpr | undefined,
  splitTagId?: string,
): BoolExpr {
  const parts: BoolExpr[] = [{ tag: rowTagId }, { tag: colTagId }];
  if (splitTagId) parts.push({ tag: splitTagId });
  if (currentFilter) parts.push(currentFilter);
  return { and: parts };
}

interface PivotModeProps {
  onDrill: (body: SearchEntitiesRequest) => void;
  /** 工作台嵌入时由外部提供，覆盖内部 filter，并隐藏内部过滤面板 */
  externalFilter?: BoolExpr;
  /** 嵌入模式：隐藏 entityType selector（由外部控制） */
  embeddedEntityType?: string;
}

export function PivotMode({ onDrill, externalFilter, embeddedEntityType }: PivotModeProps) {
  const [entityTypes, setEntityTypes] = useState<{ entityType: string; count: number }[]>([]);
  const [groups, setGroups] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [entityType,    setEntityType]    = useState<string>("");
  const [rowGroupSlug,  setRowGroupSlug]  = useState<string>("");
  const [colGroupSlug,  setColGroupSlug]  = useState<string>("");
  const [splitGroupSlug,setSplitGroupSlug] = useState<string>("");  // 切片维度（可空）
  const [topN, setTopN] = useState<number>(15);
  const [splitTopN, setSplitTopN] = useState<number>(4);

  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);

  // pivot 数据：无切片时 PivotResult；有切片时 { splitTag, data }[]
  const [singleData, setSingleData] = useState<PivotResult | null>(null);
  const [splitData,  setSplitData]  = useState<{ splitTag: { id: string; name: string; slug: string }; data: PivotResult }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // 初次加载
  useEffect(() => {
    Promise.all([
      getEntityTypes(),
      getTagGroups({ pageSize: 100 }),
    ]).then(([types, groupsResp]) => {
      setEntityTypes(types);
      setGroups(groupsResp.items.map(g => ({ id: g.id, slug: g.slug, name: g.name })));
      if (types.length > 0) setEntityType(types[0].entityType);
      if (groupsResp.items.length >= 2) {
        setRowGroupSlug(groupsResp.items[0].slug);
        setColGroupSlug(groupsResp.items[1].slug);
      }
    }).catch(e => setError(String(e.message ?? e)));
  }, []);

  const filterExpr = useMemo(
    () => externalFilter ?? buildFilterExpr(filter),
    [externalFilter, filter],
  );

  // 嵌入模式：实体类型由外部强制
  useEffect(() => {
    if (embeddedEntityType && embeddedEntityType !== entityType) {
      setEntityType(embeddedEntityType);
    }
  }, [embeddedEntityType, entityType]);

  // 主查询（自动触发）
  const runQuery = useCallback(async () => {
    if (!entityType || !rowGroupSlug || !colGroupSlug || rowGroupSlug === colGroupSlug) return;
    setLoading(true);
    setError(null);
    try {
      // 无切片：单次 pivot
      if (!splitGroupSlug) {
        const result = await searchPivot({
          entityType, rowGroupSlug, colGroupSlug,
          filter: filterExpr, topN,
        });
        setSingleData(result);
        setSplitData([]);
        return;
      }
      // 有切片：先取切片维度 group 的 top-N tags，再为每个 tag 并发 pivot
      const splitGroup = groups.find(g => g.slug === splitGroupSlug);
      if (!splitGroup) throw new Error("切片维度分组不存在");
      const groupTagsResp = await getGroupTags(splitGroup.id, { page: 1, pageSize: splitTopN });
      const splitTags = groupTagsResp.items.slice(0, splitTopN);
      if (splitTags.length === 0) {
        setSingleData(null);
        setSplitData([]);
        throw new Error(`切片维度「${splitGroup.name}」下无标签`);
      }
      const pivots = await Promise.all(
        splitTags.map(async (t) => {
          const subFilter: BoolExpr = filterExpr
            ? { and: [filterExpr, { tag: t.id }] }
            : { tag: t.id };
          const data = await searchPivot({
            entityType, rowGroupSlug, colGroupSlug,
            filter: subFilter, topN,
          });
          return { splitTag: { id: t.id, name: t.name, slug: t.slug }, data };
        })
      );
      setSplitData(pivots);
      setSingleData(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [entityType, rowGroupSlug, colGroupSlug, splitGroupSlug, filterExpr, topN, splitTopN, groups]);

  useEffect(() => { void runQuery(); }, [runQuery]);

  // 行/列下钻：拼 BoolExpr → 切到 DSL
  const handleDrill = useCallback((rowTagId: string, colTagId: string, splitTagId?: string) => {
    const expr = buildDrillExpr(rowTagId, colTagId, filterExpr, splitTagId);
    onDrill({
      entityType,
      filter: expr,
      pageSize: 50,
      include: ["tags"],
    });
  }, [entityType, filterExpr, onDrill]);

  // 整张图的最大 cell 值（跨切片统一色阶）
  const globalMaxCell = useMemo(() => {
    if (singleData) {
      let max = 0;
      for (const v of Object.values(singleData.cells)) if (v > max) max = v;
      return max;
    }
    let max = 0;
    for (const s of splitData) {
      for (const v of Object.values(s.data.cells)) if (v > max) max = v;
    }
    return max;
  }, [singleData, splitData]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* 控制栏 */}
      <div className="space-y-3 px-5 py-4 rounded-lg bg-overlay/40 border border-edge">
        {/* 第一行：实体 + X/Y/Split */}
        <div className="flex flex-wrap items-end gap-4">
          {!embeddedEntityType && (
            <ControlSelect
              label="实体类型"
              value={entityType}
              onChange={setEntityType}
              options={entityTypes.map(t => ({ value: t.entityType, label: `${t.entityType} (${t.count})` }))}
              placeholder="选择实体类型"
            />
          )}
          <ControlSelect
            label="X 轴（行）"
            value={rowGroupSlug}
            onChange={setRowGroupSlug}
            options={groups.map(g => ({ value: g.slug, label: g.name, disabled: g.slug === colGroupSlug || g.slug === splitGroupSlug }))}
            placeholder="选择分组"
          />
          <div className="self-center pb-2 text-ink-faint">
            <ArrowRight className="size-4" />
          </div>
          <ControlSelect
            label="Y 轴（列）"
            value={colGroupSlug}
            onChange={setColGroupSlug}
            options={groups.map(g => ({ value: g.slug, label: g.name, disabled: g.slug === rowGroupSlug || g.slug === splitGroupSlug }))}
            placeholder="选择分组"
          />
          <div className="self-center pb-2 text-ink-faint">
            <MoveDown className="size-4" />
          </div>
          <ControlSelect
            label="切片维度（可选）"
            value={splitGroupSlug}
            onChange={setSplitGroupSlug}
            options={[
              { value: "",  label: "无切片" },
              ...groups.map(g => ({ value: g.slug, label: g.name, disabled: g.slug === rowGroupSlug || g.slug === colGroupSlug })),
            ]}
            placeholder="无切片"
            allowEmpty
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-ink-sub">Top-N</label>
            <input
              type="number" min={1} max={50} value={topN}
              onChange={e => setTopN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="w-20 px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            />
          </div>
          {splitGroupSlug && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-ink-sub">切片数</label>
              <input
                type="number" min={1} max={12} value={splitTopN}
                onChange={e => setSplitTopN(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                className="w-20 px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
              />
            </div>
          )}
          {loading && <Loader2 className="size-4 ml-2 mb-3 text-ink-sub animate-spin" />}
        </div>

        {/* 第二行：过滤条件（嵌入模式下由外部 BoolExpr 提供，不显示内部 FilterPanel） */}
        {!externalFilter && (
          <div>
            <button
              type="button"
              onClick={() => setFilterOpen(v => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-ink-sub hover:text-ink"
            >
              <Filter className="size-3.5" />
              前置过滤 {filterExpr && <span className="text-ok">（已启用）</span>}
              <ChevronDown className={cn("size-3.5 transition-transform", filterOpen && "rotate-180")} />
            </button>
            {filterOpen && (
              <FilterPanel filter={filter} onChange={setFilter} />
            )}
          </div>
        )}
        {externalFilter && (
          <p className="text-xs text-ink-sub flex items-center gap-1.5">
            <Filter className="size-3.5" />
            过滤条件由工作台查询提供
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">
          {error}
        </div>
      )}

      {/* 单 pivot */}
      {singleData && (
        <div className="space-y-4">
          <SummaryBar data={singleData} />
          <PivotTable
            data={singleData}
            maxCell={globalMaxCell}
            onCellClick={(r, c) => handleDrill(r, c)}
          />
          <Legend max={globalMaxCell} />
        </div>
      )}

      {/* 多 pivot（切片） */}
      {splitData.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-baseline gap-3">
            <p className="text-base font-semibold text-ink">
              按 <span className="text-ink-sub">{groups.find(g => g.slug === splitGroupSlug)?.name}</span> 切片
            </p>
            <p className="text-xs text-ink-faint">共 {splitData.length} 切片，统一色阶（峰值 {globalMaxCell}）</p>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {splitData.map(s => (
              <div key={s.splitTag.id} className="rounded-lg border border-edge bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-edge bg-row-head flex items-baseline justify-between">
                  <span className="text-sm font-medium text-ink">{s.splitTag.name}</span>
                  <span className="text-xs text-ink-faint">{s.data.grandTotal} 实体</span>
                </div>
                <PivotTable
                  data={s.data}
                  maxCell={globalMaxCell}
                  onCellClick={(r, c) => handleDrill(r, c, s.splitTag.id)}
                  compact
                />
              </div>
            ))}
          </div>
          <Legend max={globalMaxCell} />
        </div>
      )}

      {!singleData && splitData.length === 0 && !loading && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-ink-sub">
          <Layers className="size-7 opacity-50" />
          <span>选择 X / Y 维度后自动加载</span>
        </div>
      )}
    </div>
  );
}

// ── 控件 ────────────────────────────────────────────────────────────────────
interface SelectOpt { value: string; label: string; disabled?: boolean }
function ControlSelect({
  label, value, onChange, options, placeholder, allowEmpty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOpt[];
  placeholder: string;
  allowEmpty?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[160px]">
      <label className="text-xs text-ink-sub">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
      >
        {(!value && !allowEmpty) && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value || "__empty__"} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── 过滤面板 ────────────────────────────────────────────────────────────────
const SRC_OPTS: { v: SrcChoice; label: string }[] = [
  { v: "manual", label: "人工" }, { v: "ai", label: "AI" },
  { v: "system", label: "系统" }, { v: "import", label: "导入" },
];
const STATUS_OPTS: { v: StatusChoice; label: string }[] = [
  { v: "active", label: "已生效" }, { v: "pending", label: "待审核" }, { v: "rejected", label: "已拒绝" },
];

function FilterPanel({ filter, onChange }: { filter: FilterState; onChange: (f: FilterState) => void }) {
  const toggle = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  return (
    <div className="mt-3 pt-3 border-t border-edge/60 space-y-3">
      <FilterRow label="来源">
        {SRC_OPTS.map(o => (
          <Chip key={o.v} active={filter.sources.includes(o.v)}
            onClick={() => onChange({ ...filter, sources: toggle(filter.sources, o.v) })}>
            {o.label}
          </Chip>
        ))}
      </FilterRow>
      <FilterRow label="状态">
        {STATUS_OPTS.map(o => (
          <Chip key={o.v} active={filter.statuses.includes(o.v)}
            onClick={() => onChange({ ...filter, statuses: toggle(filter.statuses, o.v) })}>
            {o.label}
          </Chip>
        ))}
      </FilterRow>
      <FilterRow label="置信度">
        <div className="flex items-center gap-2 text-base text-ink">
          <input
            type="number" min={0} max={1} step={0.05}
            value={filter.confidence.gte ?? ""}
            placeholder="≥"
            onChange={e => onChange({ ...filter, confidence: {
              ...filter.confidence,
              gte: e.target.value === "" ? undefined : Number(e.target.value),
            } })}
            className="w-24 px-2 py-1 rounded-md border border-edge bg-input"
          />
          <span className="text-ink-sub">~</span>
          <input
            type="number" min={0} max={1} step={0.05}
            value={filter.confidence.lte ?? ""}
            placeholder="≤"
            onChange={e => onChange({ ...filter, confidence: {
              ...filter.confidence,
              lte: e.target.value === "" ? undefined : Number(e.target.value),
            } })}
            className="w-24 px-2 py-1 rounded-md border border-edge bg-input"
          />
          {(filter.confidence.gte !== undefined || filter.confidence.lte !== undefined) && (
            <button type="button" onClick={() => onChange({ ...filter, confidence: {} })}
              className="text-ink-sub hover:text-ink"><X className="size-3.5" /></button>
          )}
        </div>
      </FilterRow>
      {(filter.sources.length > 0 || filter.statuses.length > 0 ||
        filter.confidence.gte !== undefined || filter.confidence.lte !== undefined) && (
        <button type="button" onClick={() => onChange(EMPTY_FILTER)}
          className="text-xs text-ink-sub hover:text-ink underline">清空所有过滤</button>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-ink-sub w-14 shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "px-2.5 py-0.5 rounded-full border text-xs transition-colors",
        active
          ? "border-ink bg-ink text-bg font-medium"
          : "border-edge text-ink-sub hover:text-ink hover:border-edge-mid",
      )}>
      {children}
    </button>
  );
}

// ── 汇总条 ──────────────────────────────────────────────────────────────────
function SummaryBar({ data }: { data: PivotResult }) {
  const stat = (label: string, val: number | string, sub?: string) => (
    <div className="flex flex-col">
      <span className="text-xs text-ink-sub">{label}</span>
      <span className="text-xl font-semibold text-ink">{val}</span>
      {sub && <span className="text-xs text-ink-faint mt-0.5">{sub}</span>}
    </div>
  );
  const totalCells = Object.keys(data.cells).length;
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-3 px-5 py-4 rounded-lg bg-card border border-edge">
      {stat("实体总数",   data.grandTotal)}
      {stat("行维度标签", data.rows.length)}
      {stat("列维度标签", data.cols.length)}
      {stat("非零交叉",   totalCells, `共 ${data.rows.length * data.cols.length} 格`)}
      {stat("行未分类",   data.uncategorized.row)}
      {stat("列未分类",   data.uncategorized.col)}
    </div>
  );
}

// ── 透视表（含 cell 点击下钻）────────────────────────────────────────────
function PivotTable({
  data, maxCell, onCellClick, compact,
}: {
  data: PivotResult;
  maxCell: number;
  onCellClick: (rowTagId: string, colTagId: string) => void;
  compact?: boolean;
}) {
  if (data.rows.length === 0 || data.cols.length === 0) {
    return (
      <div className={cn("text-center text-ink-sub", compact ? "p-6 text-sm" : "p-10")}>
        无数据
      </div>
    );
  }
  const pad = compact ? "px-1.5 py-1" : "px-2 py-2";
  const minW = compact ? "min-w-[40px]" : "min-w-[64px]";
  return (
    <div className={cn(!compact && "rounded-lg border border-edge bg-card", "overflow-auto")}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(
              "sticky left-0 z-10 bg-row-head text-left text-xs font-semibold text-ink-sub border-b border-r border-edge",
              pad, compact ? "min-w-[80px]" : "min-w-[120px]",
            )}>
              <span className="text-ink-sub">↘</span>
            </th>
            {data.cols.map(c => (
              <th key={c.tagId} className={cn(
                "text-xs font-medium text-ink border-b border-edge whitespace-nowrap",
                pad,
              )} title={`${c.name} (${c.total} 条)`}>
                <div className="flex flex-col items-center gap-0.5">
                  <span>{c.name}</span>
                  <span className="text-ink-faint text-[10px]">{c.total}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.tagId} className="hover:bg-row-hover">
              <th className={cn(
                "sticky left-0 z-10 bg-row-head text-left text-xs font-medium text-ink border-r border-edge whitespace-nowrap",
                pad,
              )} title={`${r.name} (${r.total} 条)`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span>{r.name}</span>
                  <span className="text-ink-faint text-[10px]">{r.total}</span>
                </div>
              </th>
              {data.cols.map(c => {
                const key = `${r.tagId}:${c.tagId}`;
                const cnt = data.cells[key] ?? 0;
                return (
                  <PivotCell
                    key={key} count={cnt} max={maxCell}
                    rowName={r.name} colName={c.name}
                    onClick={() => cnt > 0 && onCellClick(r.tagId, c.tagId)}
                    compact={compact}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  function PivotCell({
    count, max, rowName, colName, onClick, compact,
  }: {
    count: number; max: number;
    rowName: string; colName: string;
    onClick: () => void;
    compact?: boolean;
  }) {
    const ratio = max > 0 && count > 0 ? Math.log(count + 1) / Math.log(max + 1) : 0;
    const bg = count > 0 ? `oklch(0.62 0.18 250 / ${0.08 + ratio * 0.55})` : "transparent";
    return (
      <td
        onClick={onClick}
        className={cn(
          "text-center font-medium border border-edge/40",
          compact ? "text-xs px-1.5 py-1" : "text-base px-2 py-2",
          minW,
          count > 0 ? "cursor-pointer transition-all hover:outline hover:outline-2 hover:outline-ink" : "cursor-default",
          count === 0 && "text-ink-faint",
        )}
        style={{ background: bg }}
        title={count > 0 ? `${rowName} × ${colName}：${count} 条 — 点击查看明细` : `${rowName} × ${colName}：0`}
      >
        {count > 0 ? count : "·"}
      </td>
    );
  }
}

// ── 图例 ────────────────────────────────────────────────────────────────────
function Legend({ max }: { max: number }) {
  if (max === 0) return null;
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-3 text-xs text-ink-sub">
      <span>少</span>
      <div className="flex">
        {stops.map(s => (
          <div key={s} className="w-8 h-3 border border-edge/30"
            style={{ background: `oklch(0.62 0.18 250 / ${0.08 + s * 0.55})` }} />
        ))}
      </div>
      <span>多</span>
      <span className="ml-2 text-ink-faint">（峰值 {max}）</span>
    </div>
  );
}
