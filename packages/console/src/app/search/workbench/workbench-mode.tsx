"use client";

import { useState, useReducer, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Plus, Tag as TagIcon, GitBranch, Languages, Sliders, Search, FoldVertical, UnfoldVertical,
  List, Grid3x3, BarChart3, Network, CalendarRange, Loader2, Trash2, Copy, ExternalLink,
} from "lucide-react";
import {
  getEntityTypes, searchEntities, searchTags,
  type SearchEntitiesRequest, type SearchEntitiesResult, type RegisteredEntity,
  type BoolExpr,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { TagPicker, type PickedTag } from "./tag-picker";
import { LeafChip, OrGroupChip, MetaPicker, AliasPicker, TextPicker } from "./chips";
import {
  reducer, INITIAL_STATE, compileState, decompileBoolExpr,
  type LeafValue, type TagInfo,
} from "./state";
import { PivotMode } from "../pivot-mode";
import { CooccurrenceView } from "./cooccurrence-view";
import { TimelineView } from "./timeline-view";
import { useRouter } from "next/navigation";

type ViewKind = "list" | "facet" | "pivot" | "cooccurrence" | "timeline";

interface WorkbenchModeProps {
  onDrillToDsl: (body: SearchEntitiesRequest) => void;
  /** NL / DSL 模式 → workbench 的预填，反编译为 chip 树。ts 字段保证 effect 重跑。 */
  prefill?: { boolExpr: BoolExpr; entityType: string; ts: number } | null;
}

// 提取 BoolExpr 中所有 tagId / descendantOf 引用，用于预加载 tag 信息
function collectTagIdRefs(expr: unknown, into: Set<string>): void {
  if (!expr || typeof expr !== "object") return;
  const e = expr as Record<string, unknown>;
  if (typeof e.tag === "string")          into.add(e.tag);
  if (typeof e.descendantOf === "string") into.add(e.descendantOf);
  if (Array.isArray(e.and)) e.and.forEach((c) => collectTagIdRefs(c, into));
  if (Array.isArray(e.or))  e.or .forEach((c) => collectTagIdRefs(c, into));
  if (e.not) collectTagIdRefs(e.not, into);
}

export function WorkbenchMode({ onDrillToDsl, prefill }: WorkbenchModeProps) {
  const t = useTranslations("search");
  const [entityTypes, setEntityTypes] = useState<{ entityType: string; count: number }[]>([]);
  const [entityType, setEntityType]   = useState<string>("");
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const [view, setView] = useState<ViewKind>("list");
  const [showDsl, setShowDsl] = useState(false);

  // tag picker / alias picker / meta picker 状态
  const [tagPicker,   setTagPicker]   = useState<{ mode: "tag" | "descendantOf"; targetOrId?: string } | null>(null);
  const [aliasOpen,   setAliasOpen]   = useState(false);
  const [metaOpen,    setMetaOpen]    = useState(false);
  const [textOpen,    setTextOpen]    = useState(false);

  const [data, setData]     = useState<SearchEntitiesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // 编译的 BoolExpr（undefined = 无过滤）
  const filter = useMemo(() => compileState(state), [state]);

  // 加载实体类型
  useEffect(() => {
    getEntityTypes().then(types => {
      setEntityTypes(types);
      if (types.length > 0) setEntityType(types[0].entityType);
    }).catch(e => setError(String(e.message ?? e)));
  }, []);

  // 自动查询（list / facet 视图）：entityType + filter 变化时
  const run = useCallback(async () => {
    if (!entityType) return;
    if (view === "pivot" || view === "cooccurrence" || view === "timeline") return;  // 这些视图自己跑请求
    setLoading(true);
    setError(null);
    try {
      const body: SearchEntitiesRequest = {
        entityType,
        filter,
        pageSize: view === "facet" ? 1 : 30,
        include: view === "list" ? ["tags"] : [],
        facets:  view === "facet" ? ["groupId"] : [],
      };
      setData(await searchEntities(body));
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityType, filter, view]);

  useEffect(() => { void run(); }, [run]);

  // ── 接收外部 prefill：反编译 BoolExpr 为 chip 树 ────────────────────
  // 流程：
  //   1) 切换 entityType
  //   2) 提取 BoolExpr 中所有 tag/descendantOf 的 tagId 引用
  //   3) 异步加载这些 tag 的 name/groupName（用 searchTags 找一遍）
  //   4) 调 decompileBoolExpr 反编译 → dispatch load
  //   5) 反编译失败时 toast 提示并保持现有 state（用户应该用 DSL 模式）
  useEffect(() => {
    if (!prefill) return;
    let cancelled = false;
    (async () => {
      setEntityType(prefill.entityType);

      const tagIdRefs = new Set<string>();
      collectTagIdRefs(prefill.boolExpr, tagIdRefs);
      const tagInfoMap = new Map<string, TagInfo>();
      if (tagIdRefs.size > 0) {
        // 没有 batch-by-id 接口，先做 best-effort：拉若干 tag 然后过滤
        // 后端实际 include 了 group 字段，但 Tag 类型没暴露，临时 cast
        try {
          const all = await searchTags({ pageSize: 200 });
          type TagWithGroup = typeof all.items[number] & {
            group?: { id: string; slug: string; name: string };
          };
          for (const tRaw of all.items) {
            if (!tagIdRefs.has(tRaw.id)) continue;
            const tg = tRaw as TagWithGroup;
            tagInfoMap.set(tg.id, {
              tagId:     tg.id,
              tagName:   tg.name,
              groupSlug: tg.group?.slug ?? "",
              groupName: tg.group?.name ?? "?",
            });
          }
        } catch { /* 失败也继续，用 tagId 占位 */ }
      }

      const decompiled = decompileBoolExpr(
        prefill.boolExpr,
        (tid) => tagInfoMap.get(tid),
      );
      if (cancelled) return;
      if (decompiled) {
        dispatch({ type: "load", state: decompiled });
      } else {
        setError(t("wbDecompileError"));
      }
    })();
    return () => { cancelled = true; };
  }, [prefill, t]);

  // tag picker 选中回调
  const onTagPicked = (t: PickedTag) => {
    if (!tagPicker) return;
    const v: LeafValue = tagPicker.mode === "descendantOf"
      ? { type: "descendantOf", tagId: t.tagId, tagName: t.tagName, groupName: t.groupName }
      : { type: "tag",          tagId: t.tagId, tagName: t.tagName, groupName: t.groupName };
    dispatch({ type: "add-leaf", value: v, targetGroupId: tagPicker.targetOrId });
  };

  // 下钻：当前 filter 直接发到 DSL
  const drill = () => {
    onDrillToDsl({
      entityType, filter, pageSize: 50, include: ["tags"],
    });
  };

  const router = useRouter();

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── 顶部控制：entityType + 视图切换 ─────────────────────── */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5 min-w-[200px]">
          <label className="text-xs text-ink-sub">{t("entityType")}</label>
          <select
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
            className="px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
          >
            {entityTypes.map(et => (
              <option key={et.entityType} value={et.entityType}>
                {et.entityType} ({et.count})
              </option>
            ))}
          </select>
        </div>

        {/* 视图切换器 — 紧凑图标模式 */}
        <div className="flex items-center gap-0.5 p-1 rounded-lg bg-surface-alt border border-edge">
          {[
            { id: "list"         as const, icon: List,          label: t("viewList") },
            { id: "facet"        as const, icon: BarChart3,     label: t("viewFacet") },
            { id: "pivot"        as const, icon: Grid3x3,       label: t("viewPivot") },
            { id: "cooccurrence" as const, icon: Network,       label: t("viewCooccurrence") },
            { id: "timeline"     as const, icon: CalendarRange, label: t("viewTimeline") },
          ].map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              title={v.label}
              aria-label={v.label}
              className={cn(
                "p-2 rounded-md transition-colors",
                view === v.id
                  ? "bg-ink text-surface"
                  : "text-ink-faint hover:text-ink hover:bg-row-hover",
              )}
            >
              <v.icon className="size-4" />
            </button>
          ))}
        </div>

        {/* 结果数 KPI badge */}
        {data && view !== "pivot" && (
          <div className="ml-auto self-end pb-1 flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-1/10 border border-brand-1/25">
              <span className="text-lg font-bold text-ink tabular-nums">{data.total.toLocaleString()}</span>
              <span className="text-xs text-ink-sub">{t("resultsCount")}</span>
            </div>
          </div>
        )}
        {loading && <Loader2 className="size-4 text-ink-sub animate-spin mb-3" />}
      </div>

      {/* ── 查询构建区 ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-edge bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-sub uppercase tracking-wider font-medium">{t("wbConditions")}</span>
          <div className="flex items-center gap-1">
            {state.children.length > 0 && (
              <button
                type="button"
                onClick={() => dispatch({ type: "reset" })}
                title={t("wbClearTitle")}
                className="text-xs text-ink-sub hover:text-bad flex items-center gap-1 px-2 py-1 rounded hover:bg-row-hover"
              >
                <Trash2 className="size-3" />
                {t("wbClear")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowDsl(s => !s)}
              className="text-xs text-ink-sub hover:text-ink flex items-center gap-1 px-2 py-1 rounded hover:bg-row-hover"
            >
              {showDsl ? <FoldVertical className="size-3" /> : <UnfoldVertical className="size-3" />}
              {t("wbDslMirror")}
            </button>
          </div>
        </div>

        {/* chip 区 */}
        <div className="flex flex-wrap items-center gap-2 min-h-[40px]">
          {state.children.length === 0 && (
            <span className="text-sm text-ink-faint italic">
              {t("wbEmptyHint")}
            </span>
          )}
          {state.children.map((c, i) => (
            <span key={c.id} className="inline-flex items-center gap-2">
              {i > 0 && (
                <span className="text-2xs font-bold text-ink-faint tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-surface-alt border border-edge">
                  AND
                </span>
              )}
              {c.kind === "leaf" ? (
                <LeafChip
                  node={c}
                  onRemove={() => dispatch({ type: "remove", nodeId: c.id })}
                  onToggleNot={() => dispatch({ type: "toggle-not", nodeId: c.id })}
                />
              ) : (
                <OrGroupChip
                  group={c}
                  onRemoveGroup={() => dispatch({ type: "remove", nodeId: c.id })}
                  onRemoveLeaf={(lid) => dispatch({ type: "remove", nodeId: lid })}
                  onToggleNot={(lid) => dispatch({ type: "toggle-not", nodeId: lid })}
                  onAddLeaf={() => setTagPicker({ mode: "tag", targetOrId: c.id })}
                />
              )}
            </span>
          ))}
        </div>

        {/* 添加按钮组 */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-edge/50">
          <AddBtn onClick={() => setTagPicker({ mode: "tag" })}          icon={TagIcon}   label={t("wbAddTag")} />
          <AddBtn onClick={() => setTagPicker({ mode: "descendantOf" })} icon={GitBranch} label={t("wbAddDescendant")} />
          <AddBtn onClick={() => setAliasOpen(true)}                     icon={Languages} label={t("wbAddAlias")} />
          <AddBtn onClick={() => setTextOpen(true)}                      icon={Search}    label={t("wbAddText")} />
          <AddBtn onClick={() => setMetaOpen(true)}                      icon={Sliders}   label={t("wbAddMeta")} />
          <div className="w-px h-5 bg-edge mx-1" />
          <AddBtn onClick={() => dispatch({ type: "add-or-group" })}     icon={Plus}      label={t("wbAddOrGroup")} emphasis="ok" />
        </div>

        {/* DSL 镜像 */}
        {showDsl && (
          <div className="mt-3 pt-3 border-t border-edge/50">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-ink-sub">{t("wbCompiledExpr")}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const json = filter ? JSON.stringify(filter, null, 2) : t("wbEmptyExpr");
                    navigator.clipboard.writeText(json);
                  }}
                  title={t("wbCopyTitle")}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-ink-faint hover:text-ink hover:bg-surface-alt rounded transition-colors"
                >
                  <Copy size={10} />
                  {t("wbCopy")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // 跳转到 DSL 模式并带上当前的 filter
                    const query = filter ? encodeURIComponent(JSON.stringify(filter)) : "";
                    router.push(`/search?mode=dsl&filter=${query}`);
                  }}
                  title={t("wbOpenInDslTitle")}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-ink-faint hover:text-ink hover:bg-surface-alt rounded transition-colors"
                >
                  <ExternalLink size={10} />
                  {t("wbOpenInDsl")}
                </button>
              </div>
            </div>
            <pre className="text-xs font-mono text-ink bg-input rounded-md p-3 overflow-auto max-h-48">
              {filter
                ? JSON.stringify(filter, null, 2)
                : t("wbEmptyExpr")}
            </pre>
          </div>
        )}
      </div>

      {/* ── 错误 ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">
          {error}
        </div>
      )}

      {/* ── 视图区域 ─────────────────────────────────────────────── */}
      <div>
        {view === "list"  && data && <ListView data={data} onDrill={drill} />}
        {view === "facet" && data && <FacetView data={data} />}
        {view === "pivot" && entityType && (
          <PivotMode
            onDrill={onDrillToDsl}
            externalFilter={filter}
            embeddedEntityType={entityType}
          />
        )}
        {view === "cooccurrence" && entityType && (
          <CooccurrenceView
            entityType={entityType}
            filter={filter}
            topN={15}
          />
        )}
        {view === "timeline" && entityType && (
          <TimelineView
            entityType={entityType}
            filter={filter}
          />
        )}
      </div>

      {/* ── 模态 ─────────────────────────────────────────────────── */}
      <TagPicker
        open={tagPicker !== null}
        onClose={() => setTagPicker(null)}
        onPick={onTagPicked}
        mode={tagPicker?.mode ?? "tag"}
      />
      <AliasPicker
        open={aliasOpen}
        onClose={() => setAliasOpen(false)}
        onPick={(v) => dispatch({ type: "add-leaf", value: v })}
      />
      <MetaPicker
        open={metaOpen}
        onClose={() => setMetaOpen(false)}
        onPick={(v) => dispatch({ type: "add-leaf", value: v })}
      />
      <TextPicker
        open={textOpen}
        onClose={() => setTextOpen(false)}
        onPick={(v) => dispatch({ type: "add-leaf", value: v })}
      />
    </div>
  );
}

function AddBtn({
  icon: Icon, label, onClick, emphasis,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  emphasis?: "ok";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
        emphasis === "ok"
          ? "border-ok/40 text-ok hover:bg-ok/10"
          : "border-edge text-ink hover:bg-row-hover",
      )}
    >
      <Plus className="size-3" />
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

// ── 视图：实体列表 ──────────────────────────────────────────────────────────
function ListView({ data, onDrill }: { data: SearchEntitiesResult; onDrill: () => void }) {
  const t = useTranslations("search");
  if (data.items.length === 0) {
    return <div className="rounded-lg border border-edge bg-card p-12 text-center text-ink-sub">{t("noMatch")}</div>;
  }
  return (
    <div className="rounded-lg border border-edge bg-card divide-y divide-edge max-h-[700px] overflow-auto">
      {data.items.map((item: RegisteredEntity) => (
        <div key={`${item.entityType}:${item.entityId}`} className="p-3.5 hover:bg-row-hover">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-xs text-ink-faint">{item.entityType}</span>
            <span className="text-sm text-ink font-mono">{item.entityId}</span>
            <span className="ml-auto text-xs text-ink-faint">
              {new Date(item.registeredAt).toLocaleString(undefined)}
            </span>
          </div>
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map(tg => (
                <span
                  key={tg.id}
                  className="px-2 py-0.5 rounded-md bg-overlay text-xs text-ink"
                  title={`${tg.group.name} · ${tg.source}${tg.confidence != null ? ` · ${(tg.confidence * 100).toFixed(0)}%` : ""}`}
                >
                  {tg.name}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {data.total > data.items.length && (
        <div className="p-3 text-center">
          <button
            type="button"
            onClick={onDrill}
            className="text-sm text-ok hover:underline"
          >
            {t("wbListMore", { count: data.total - data.items.length })}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 视图：Facet 分布 ────────────────────────────────────────────────────────
function FacetView({ data }: { data: SearchEntitiesResult }) {
  const t = useTranslations("search");
  const facets = data.facets?.groupId;
  if (!facets || Object.keys(facets).length === 0) {
    return <div className="rounded-lg border border-edge bg-card p-12 text-center text-ink-sub">{t("wbFacetEmpty")}</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Object.entries(facets).map(([groupSlug, tags]) => {
        const max = Math.max(...tags.map(t => t.count));
        return (
          <div key={groupSlug} className="rounded-lg border border-edge bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-edge bg-row-head flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink">{groupSlug}</span>
              <span className="text-xs text-ink-faint">{t("wbFacetTags", { count: tags.length })}</span>
            </div>
            <div className="p-3 space-y-1.5 max-h-72 overflow-auto">
              {tags.slice(0, 30).map(t => {
                const w = (t.count / max) * 100;
                return (
                  <div key={t.tagId} className="relative h-6 flex items-center">
                    <div
                      className="absolute inset-0 rounded bg-ink/10"
                      style={{ width: `${w}%` }}
                    />
                    <div className="relative flex items-center justify-between w-full px-2 text-xs">
                      <span className="text-ink truncate">{t.tagName}</span>
                      <span className="text-ink-sub font-mono">{t.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
