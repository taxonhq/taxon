"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, AlertCircle, Wrench, Braces, Send, Settings, Lightbulb } from "lucide-react";
import Link from "next/link";
import {
  getEntityTypes, nlToDsl, getLlmConfig,
  type SearchEntitiesRequest,
} from "@/lib/api";
import type { BoolExpr } from "@/lib/api";

const SUGGESTION_KEYS = ["nlSug1", "nlSug2", "nlSug3", "nlSug4", "nlSug5", "nlSug6"] as const;

interface NlModeProps {
  /** 应用到 DSL tab */
  onApplyToDsl: (body: SearchEntitiesRequest) => void;
  /** 应用到工作台 tab（反编译 BoolExpr 为 chip 树继续编辑） */
  onApplyToWorkbench: (boolExpr: BoolExpr, entityType: string) => void;
}

export function NlMode({ onApplyToDsl, onApplyToWorkbench }: NlModeProps) {
  const t = useTranslations("search");
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
          <p className="text-lg font-semibold text-ink">{t("nlNotEnabledTitle")}</p>
          <p className="text-base text-ink-sub">
            {t("nlNotEnabledDesc")}
          </p>
        </div>
        <Link
          href="/settings/llm"
          className="px-4 py-2 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 inline-flex items-center gap-2"
        >
          <Settings className="size-4" />
          {t("nlGoConfigure")}
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
            <label className="text-xs text-ink-sub">{t("entityType")}</label>
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              className="px-3 py-2 rounded-md border border-edge bg-input text-base text-ink"
            >
              <option value="">{t("nlAllTypes")}</option>
              {entityTypes.map(et => (
                <option key={et.entityType} value={et.entityType}>
                  {et.entityType} ({et.count})
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-ink-faint pb-2 flex-1">
            {t("nlEntityHint")}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-ink-sub flex items-center gap-1.5">
            <Sparkles className="size-3" />
            {t("nlDescLabel")}
          </label>
          <div className="relative">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={3}
              placeholder={t("nlPlaceholder")}
              className="w-full px-4 py-3 rounded-lg border border-edge bg-input text-base text-ink resize-none"
            />
            <button
              type="button"
              onClick={submit}
              disabled={loading || !text.trim()}
              className="absolute bottom-3 right-3 px-3 py-1.5 rounded-md bg-ink text-surface text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {t("nlTranslate")}
            </button>
          </div>
          <p className="text-xs text-ink-faint">{t("nlShortcut")}</p>
        </div>

        {/* 建议 */}
        <div>
          <p className="text-xs text-ink-sub flex items-center gap-1 mb-2">
            <Lightbulb className="size-3" />
            {t("nlExamples")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTION_KEYS.map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setText(t(key))}
                className="px-2.5 py-1 rounded-md border border-edge text-xs text-ink-sub hover:text-ink hover:border-edge-mid transition-colors"
              >
                {t(key)}
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
            <span className="text-base font-medium text-ink">{t("nlResult")}</span>
            <span className="text-xs text-ink-faint ml-auto font-mono">{result.model}</span>
          </div>

          {/* AI 解释 */}
          {result.explanation && (
            <div className="px-5 py-3 border-b border-edge bg-card text-base text-ink-sub">
              <span className="text-ink">{t("nlExplanation")}</span>
              {result.explanation}
            </div>
          )}

          {/* BoolExpr */}
          {result.boolExpr ? (
            <>
              <div className="px-5 py-4 bg-card">
                <p className="text-xs text-ink-sub mb-2">{t("nlGeneratedExpr")}</p>
                <pre className="text-sm font-mono text-ink bg-input rounded-md p-3 overflow-auto max-h-72 leading-relaxed">
                  {JSON.stringify(result.boolExpr, null, 2)}
                </pre>
              </div>
              <div className="px-5 py-3 border-t border-edge bg-row-head flex items-center gap-2 flex-wrap">
                <span className="text-sm text-ink-sub">{t("nlApply")}</span>
                <button
                  type="button"
                  onClick={() => result.boolExpr && entityType && onApplyToWorkbench(result.boolExpr, entityType)}
                  disabled={!entityType}
                  title={!entityType ? t("nlEditInWbDisabled") : t("nlEditInWbTitle")}
                  className="px-3 py-1.5 rounded-md border border-edge text-sm text-ink hover:bg-row-hover inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Wrench className="size-3.5" />
                  {t("nlEditInWb")}
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
                  {t("nlSendToDsl")}
                </button>
                <span className="text-xs text-ink-faint ml-auto">
                  {t("nlNotSatisfied")}
                </span>
              </div>
            </>
          ) : (
            <div className="px-5 py-6 text-center text-ink-sub">
              <p>{t("nlNoExpr")}</p>
              <p className="text-xs text-ink-faint mt-1">{t("nlNoExprHint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
