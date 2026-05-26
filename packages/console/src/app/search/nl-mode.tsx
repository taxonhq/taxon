"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2, AlertCircle, Wrench, Braces, Send, Settings, Lightbulb } from "lucide-react";
import Link from "next/link";
import {
  getEntityTypes, nlToDsl, getLlmConfig,
  type SearchEntitiesRequest,
} from "@/lib/api";
import type { BoolExpr } from "@/lib/api";

const SUGGESTIONS = [
  "找川菜",
  "蒸或炖的菜",
  "麻辣鲜香的川菜",
  "热菜但不要川菜",
  "酸甜口味的菜",
  "粤菜的清淡鲜美菜",
];

interface NlModeProps {
  /** 应用到 DSL tab */
  onApplyToDsl: (body: SearchEntitiesRequest) => void;
  /** 应用到工作台 tab（反编译 BoolExpr 为 chip 树继续编辑） */
  onApplyToWorkbench: (boolExpr: BoolExpr, entityType: string) => void;
}

export function NlMode({ onApplyToDsl, onApplyToWorkbench }: NlModeProps) {
  const [entityTypes, setEntityTypes] = useState<{ entityType: string; count: number }[]>([]);
  const [entityType,  setEntityType]  = useState<string>("");
  const [text,        setText]        = useState<string>("");
  const [loading,     setLoading]     = useState(false);
  const [llmReady,    setLlmReady]    = useState<boolean | null>(null);   // null = 加载中

  const [result, setResult] = useState<null | { boolExpr?: BoolExpr; explanation: string; model: string }>(null);
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getEntityTypes(), getLlmConfig().catch(() => null)])
      .then(([types, cfg]) => {
        setEntityTypes(types);
        if (types.length > 0) setEntityType(types[0].entityType);
        setLlmReady(Boolean(cfg?.hasApiKey && cfg.enabled));
      })
      .catch(() => setLlmReady(false));
  }, []);

  const submit = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await nlToDsl(text.trim(), entityType || undefined);
      setResult(r);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  };

  if (llmReady === false) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
        <div className="size-16 rounded-full bg-overlay flex items-center justify-center">
          <Settings className="size-7 text-ink-sub" />
        </div>
        <div className="space-y-2 max-w-md">
          <p className="text-lg font-semibold text-ink">自然语言查询尚未启用</p>
          <p className="text-base text-ink-sub">
            管理员需要先在「LLM 设置」中配置一个大模型 API key 并启用，才能使用此功能。
          </p>
        </div>
        <Link
          href="/settings/llm"
          className="px-4 py-2 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 inline-flex items-center gap-2"
        >
          <Settings className="size-4" />
          前往配置
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">
      {/* 输入区 */}
      <div className="rounded-xl border border-edge bg-card p-5 space-y-4">
        <div className="flex items-end gap-4">
          <div className="flex flex-col gap-1.5 min-w-[200px]">
            <label className="text-xs text-ink-sub">实体类型</label>
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              className="px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            >
              <option value="">所有类型（更慢）</option>
              {entityTypes.map(t => (
                <option key={t.entityType} value={t.entityType}>
                  {t.entityType} ({t.count})
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-ink-faint pb-2 flex-1">
            指定实体类型可大幅提升翻译准确率（AI 能更精确地从该类型可用的标签上下文中匹配）
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-ink-sub flex items-center gap-1.5">
            <Sparkles className="size-3" />
            自然语言描述
          </label>
          <div className="relative">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={3}
              placeholder='例：「川菜或湘菜，但不要素食，要 AI 高置信度的」'
              className="w-full px-4 py-3 rounded-lg border border-edge bg-input text-base text-ink resize-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={loading || !text.trim()}
              className="absolute bottom-3 right-3 px-3 py-1.5 rounded-md bg-ink text-surface text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              翻译
            </button>
          </div>
          <p className="text-xs text-ink-faint">⌘ + Enter 快捷发送</p>
        </div>

        {/* 建议 */}
        <div>
          <p className="text-xs text-ink-sub flex items-center gap-1 mb-2">
            <Lightbulb className="size-3" />
            示例查询
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setText(s)}
                className="px-2.5 py-1 rounded-md border border-edge text-xs text-ink-sub hover:text-ink hover:border-edge-mid transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 错误 */}
      {error && (
        <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 结果 */}
      {result && (
        <div className="rounded-xl border border-edge bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-edge bg-row-head flex items-center gap-2">
            <Sparkles className="size-4 text-ok" />
            <span className="text-base font-medium text-ink">翻译结果</span>
            <span className="text-xs text-ink-faint ml-auto font-mono">{result.model}</span>
          </div>

          {/* AI 解释 */}
          {result.explanation && (
            <div className="px-5 py-3 border-b border-edge bg-card text-base text-ink-sub">
              <span className="text-ink">解释：</span>
              {result.explanation}
            </div>
          )}

          {/* BoolExpr */}
          {result.boolExpr ? (
            <>
              <div className="px-5 py-4 bg-card">
                <p className="text-xs text-ink-sub mb-2">生成的 BoolExpr：</p>
                <pre className="text-sm font-mono text-ink bg-input rounded-md p-3 overflow-auto max-h-72 leading-relaxed">
                  {JSON.stringify(result.boolExpr, null, 2)}
                </pre>
              </div>
              <div className="px-5 py-3 border-t border-edge bg-row-head flex items-center gap-2 flex-wrap">
                <span className="text-sm text-ink-sub">应用：</span>
                <button
                  type="button"
                  onClick={() => result.boolExpr && entityType && onApplyToWorkbench(result.boolExpr, entityType)}
                  disabled={!entityType}
                  title={!entityType ? "请先选择实体类型" : "把 BoolExpr 反编译为工作台 chip，继续可视化编辑"}
                  className="px-3 py-1.5 rounded-md border border-edge text-sm text-ink hover:bg-row-hover inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Wrench className="size-3.5" />
                  在工作台编辑
                </button>
                <button
                  type="button"
                  onClick={() => result.boolExpr && onApplyToDsl({
                    entityType: entityType || "dish",
                    filter:     result.boolExpr,
                    pageSize:   50,
                    include:    ["tags"],
                  })}
                  className="px-3 py-1.5 rounded-md bg-ink text-surface text-sm font-medium inline-flex items-center gap-1.5 hover:opacity-90"
                >
                  <Braces className="size-3.5" />
                  发送到 DSL 并执行
                </button>
                <span className="text-xs text-ink-faint ml-auto">
                  不满意？修改文字后重新翻译
                </span>
              </div>
            </>
          ) : (
            <div className="px-5 py-6 text-center text-ink-sub">
              <p>模型未能从这句话中解析出有效查询。</p>
              <p className="text-xs text-ink-faint mt-1">请尝试更具体的描述，或参考上方示例查询。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
