"use client";

import { useState, useEffect, useMemo } from "react";
import { Play, FileText, Loader2, Copy, Check } from "lucide-react";
import {
  searchEntities, getEntityTypes,
  type SearchEntitiesRequest, type SearchEntitiesResult,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// 预置模板：从 issue #17 的 10 个示例中精选最有代表性的
const TEMPLATES: { id: string; label: string; body: SearchEntitiesRequest }[] = [
  {
    id: "all",
    label: "全集（无过滤）",
    body: { entityType: "dish", pageSize: 20, include: ["tags"] },
  },
  {
    id: "single-tag",
    label: "单标签：川菜",
    body: {
      entityType: "dish",
      filter: { tagSlug: "sichuan", groupSlug: "cuisine" },
      pageSize: 20, include: ["tags"],
    },
  },
  {
    id: "or",
    label: "OR：川菜 或 湘菜",
    body: {
      entityType: "dish",
      filter: { or: [
        { tagSlug: "sichuan", groupSlug: "cuisine" },
        { tagSlug: "hunan",   groupSlug: "cuisine" },
      ] },
      pageSize: 20, include: ["tags"],
    },
  },
  {
    id: "and-not",
    label: "AND + NOT：川菜 且 非素食",
    body: {
      entityType: "dish",
      filter: { and: [
        { tagSlug: "sichuan", groupSlug: "cuisine" },
        { not: { tagSlug: "vegan", groupSlug: "dietary" } },
      ] },
      pageSize: 20, include: ["tags"],
    },
  },
  {
    id: "audit",
    label: "审核流：待审 AI 标签",
    body: {
      entityType: "dish",
      filter: { and: [{ source: ["ai"] }, { status: ["pending"] }] },
      pageSize: 20, include: ["tags"],
    },
  },
  {
    id: "facet-only",
    label: "看 facet 分布",
    body: {
      entityType: "dish",
      pageSize: 1,
      facets: ["groupId"],
    },
  },
];

const DEFAULT_BODY = JSON.stringify(TEMPLATES[0].body, null, 2);

interface DslModeProps {
  /** 从 Pivot 下钻时传入的预填请求体（ts 字段保证同 body 也能触发 useEffect） */
  prefill?: { body: SearchEntitiesRequest; ts: number } | null;
}

export function DslMode({ prefill }: DslModeProps) {
  const [entityTypes, setEntityTypes] = useState<{ entityType: string; count: number }[]>([]);
  const [raw, setRaw]       = useState<string>(DEFAULT_BODY);
  const [data, setData]     = useState<SearchEntitiesResult | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoRunPending, setAutoRunPending] = useState(false);

  useEffect(() => {
    getEntityTypes().then(setEntityTypes).catch(() => {});
  }, []);

  // Pivot → DSL 下钻：消费 prefill，预填编辑器并标记自动运行
  useEffect(() => {
    if (prefill) {
      setRaw(JSON.stringify(prefill.body, null, 2));
      setAutoRunPending(true);
    }
  }, [prefill]);

  // 客户端先做 JSON 语法校验
  const { parsed, parseError } = useMemo(() => {
    try {
      return { parsed: JSON.parse(raw) as SearchEntitiesRequest, parseError: null };
    } catch (e) {
      return { parsed: null, parseError: (e as Error).message };
    }
  }, [raw]);

  const run = async () => {
    if (!parsed) return;
    setLoading(true);
    setError(null);
    try {
      setData(await searchEntities(parsed));
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // 下钻自动执行：raw 已更新、解析通过、且 autoRunPending=true → 自动跑一次
  useEffect(() => {
    if (autoRunPending && parsed && !parseError && !loading) {
      setAutoRunPending(false);
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunPending, parsed, parseError]);

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find(x => x.id === id);
    if (t) setRaw(JSON.stringify(t.body, null, 2));
  };

  const copyCurl = () => {
    if (!parsed) return;
    const cmd = `curl -X POST http://localhost:3300/search/entities \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(parsed)}'`;
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-fade-in">
      {/* 左：编辑器 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="size-4 text-ink-sub" />
          <span className="text-base font-medium text-ink">BoolExpr 请求体</span>
          <select
            onChange={e => { if (e.target.value) applyTemplate(e.target.value); e.target.value = ""; }}
            className="ml-auto px-3 py-1.5 rounded-md border border-edge bg-input text-base text-ink"
          >
            <option value="">载入示例…</option>
            {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button
            type="button"
            onClick={copyCurl}
            disabled={!parsed}
            title="复制为 curl 命令"
            className="px-3 py-1.5 rounded-md border border-edge bg-card text-base text-ink hover:bg-row-hover disabled:opacity-50 flex items-center gap-1.5"
          >
            {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            curl
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!parsed || loading}
            className="px-4 py-1.5 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            发送
          </button>
        </div>

        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          spellCheck={false}
          rows={26}
          className={cn(
            "w-full px-4 py-3 rounded-lg border bg-input text-sm leading-relaxed text-ink resize-none",
            "font-mono",
            parseError ? "border-bad/40" : "border-edge",
          )}
        />

        {parseError && (
          <div className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad font-mono">
            JSON 语法错误: {parseError}
          </div>
        )}

        {entityTypes.length > 0 && parsed && !parseError && (
          <div className="text-xs text-ink-faint">
            可用实体类型: {entityTypes.map(t => `${t.entityType}(${t.count})`).join("、")}
          </div>
        )}
      </div>

      {/* 右：结果 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-medium text-ink">响应结果</span>
          {data && (
            <span className="text-xs text-ink-sub">
              共 <strong className="text-ink">{data.total}</strong> 条，本页 {data.items.length} 条
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-base text-bad">
            {error}
          </div>
        )}

        {data && <ResultPanel data={data} />}

        {!data && !error && (
          <div className="rounded-lg border border-edge bg-card/50 p-10 text-center text-ink-sub text-base">
            点击「发送」执行查询
          </div>
        )}
      </div>
    </div>
  );
}

// ── 结果展示 ──────────────────────────────────────────────────────────────
function ResultPanel({ data }: { data: SearchEntitiesResult }) {
  return (
    <div className="space-y-4">
      {/* facets */}
      {data.facets && Object.keys(data.facets).length > 0 && (
        <div className="rounded-lg border border-edge bg-card p-4">
          <p className="text-xs text-ink-sub mb-2 font-medium">Facets</p>
          {Object.entries(data.facets).map(([dim, byGroup]) => (
            <div key={dim} className="space-y-3">
              {Object.entries(byGroup).map(([group, tags]) => (
                <div key={group}>
                  <p className="text-xs text-ink-faint mb-1.5">{group}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.slice(0, 8).map(t => (
                      <span key={t.tagId} className="px-2 py-0.5 rounded-md bg-overlay text-xs text-ink">
                        {t.tagName} <span className="text-ink-faint">{t.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* items */}
      <div className="rounded-lg border border-edge bg-card divide-y divide-edge max-h-[680px] overflow-auto">
        {data.items.length === 0 ? (
          <div className="p-8 text-center text-ink-sub text-base">无匹配实体</div>
        ) : (
          data.items.map(item => (
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
                  {item.tags.map(t => (
                    <span
                      key={t.id}
                      className="px-2 py-0.5 rounded-md bg-overlay text-xs text-ink"
                      title={`${t.group.name} · ${t.source}${t.confidence != null ? ` · ${(t.confidence * 100).toFixed(0)}%` : ""}`}
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
