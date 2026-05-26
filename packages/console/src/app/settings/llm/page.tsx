"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2, Eye, EyeOff, CheckCircle2, AlertCircle, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  getLlmConfig, updateLlmConfig, nlToDsl,
  type LlmConfigPublic, type LlmProvider,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const MODEL_PRESETS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  openai:    ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"],
};

export default function LlmSettingsPage() {
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; message: string }>(null);

  const [cfg,      setCfg]      = useState<LlmConfigPublic | null>(null);
  const [provider, setProvider] = useState<LlmProvider>("anthropic");
  const [model,    setModel]    = useState<string>("claude-sonnet-4-5");
  const [baseUrl,  setBaseUrl]  = useState<string>("");
  const [apiKey,   setApiKey]   = useState<string>("");
  const [keepKey,  setKeepKey]  = useState<boolean>(true);
  const [showKey,  setShowKey]  = useState<boolean>(false);
  const [enabled,  setEnabled]  = useState<boolean>(false);

  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    getLlmConfig()
      .then(c => {
        setCfg(c);
        if (c.provider) setProvider(c.provider);
        if (c.model)    setModel(c.model);
        if (c.baseUrl)  setBaseUrl(c.baseUrl);
        setEnabled(c.enabled);
        setKeepKey(c.hasApiKey);  // 有 key 默认保持；无 key 必须输入新的
      })
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  const onSave = async () => {
    setSaving(true); setError(null); setSavedNotice(null);
    try {
      const next = await updateLlmConfig({
        provider, model,
        apiKey:  keepKey ? undefined : apiKey,
        baseUrl: baseUrl.trim() || undefined,
        enabled,
      });
      setCfg(next);
      setApiKey(""); setKeepKey(true);
      setSavedNotice("配置已保存");
      setTimeout(() => setSavedNotice(null), 2500);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await nlToDsl("找川菜");
      setTestResult({
        ok: true,
        message: `调用成功 · ${res.model}${res.boolExpr ? " · 已生成 BoolExpr" : " · 模型未能生成有效查询"}`,
      });
    } catch (e) {
      setTestResult({ ok: false, message: String((e as Error).message ?? e) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="LLM 设置" description="加载中…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <PageHeader
        title="LLM 设置"
        description="配置自然语言查询使用的大模型 — API key 会经 AES-256-GCM 加密存入数据库"
      />

      {error && (
        <div className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-edge bg-card p-6 space-y-5">
        {/* Provider */}
        <Field label="服务商" hint="不同服务商使用各自的官方 SDK">
          <div className="inline-flex rounded-md border border-edge overflow-hidden">
            {(["anthropic", "openai"] as const).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setProvider(p);
                  // 自动切换到该 provider 的默认模型
                  if (!MODEL_PRESETS[p].includes(model)) setModel(MODEL_PRESETS[p][0]);
                }}
                className={cn(
                  "px-4 py-2 text-base flex items-center gap-2 transition-colors",
                  provider === p ? "bg-ink text-surface font-medium" : "text-ink hover:bg-row-hover",
                )}
              >
                {p === "anthropic" ? "Anthropic Claude" : "OpenAI"}
              </button>
            ))}
          </div>
        </Field>

        {/* Model */}
        <Field label="模型" hint="结构化输出能力强的模型效果更好">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              className="px-3 py-2 rounded-md border border-edge bg-input text-base text-ink w-72"
              placeholder="模型 ID（如 claude-sonnet-4-5）"
            />
            <div className="flex flex-wrap gap-1.5">
              {MODEL_PRESETS[provider].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className={cn(
                    "px-2 py-1 rounded border text-xs transition-colors",
                    model === m
                      ? "border-ink bg-ink text-surface"
                      : "border-edge text-ink-sub hover:text-ink hover:border-edge-mid",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </Field>

        {/* Base URL */}
        <Field label="Base URL（可选）" hint="自建中转 / Azure / 第三方兼容 endpoint。空 = 使用官方默认">
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            className="px-3 py-2 rounded-md border border-edge bg-input text-base text-ink w-full max-w-md"
            placeholder={provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
          />
        </Field>

        {/* API Key */}
        <Field
          label="API Key"
          hint="存入数据库时经 AES-256-GCM 加密；前端永不回显明文"
        >
          {cfg?.hasApiKey && keepKey ? (
            <div className="flex items-center gap-3">
              <span className="px-3 py-2 rounded-md bg-overlay text-base text-ink font-mono">
                {cfg.apiKeyMask}
              </span>
              <button
                type="button"
                onClick={() => { setKeepKey(false); setApiKey(""); }}
                className="text-base text-ok hover:underline"
              >
                替换
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-md">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 rounded-md border border-edge bg-input text-base text-ink font-mono"
                  placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-sub hover:text-ink"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {cfg?.hasApiKey && (
                <button
                  type="button"
                  onClick={() => { setKeepKey(true); setApiKey(""); }}
                  className="text-base text-ink-sub hover:text-ink"
                >
                  取消替换
                </button>
              )}
            </div>
          )}
        </Field>

        {/* Enabled */}
        <Field label="启用" hint="禁用时所有自然语言查询请求返回 400">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="size-4"
            />
            <span className="text-base text-ink">{enabled ? "已启用" : "已禁用"}</span>
          </label>
        </Field>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-3 border-t border-edge">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || (!keepKey && !apiKey && !cfg?.hasApiKey)}
            className="px-4 py-2 rounded-md bg-ink text-surface text-base font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={testing || !cfg?.hasApiKey || !enabled}
            className="px-4 py-2 rounded-md border border-edge text-base text-ink hover:bg-row-hover disabled:opacity-50 inline-flex items-center gap-2"
            title={!cfg?.hasApiKey ? "需要先保存配置" : !enabled ? "需要先启用" : "用「找川菜」做一次实际调用"}
          >
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            测试连接
          </button>
          {savedNotice && (
            <span className="text-base text-ok inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-4" /> {savedNotice}
            </span>
          )}
          {testResult && (
            <span className={cn(
              "text-base inline-flex items-center gap-1.5",
              testResult.ok ? "text-ok" : "text-bad",
            )}>
              {testResult.ok ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              {testResult.message}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-edge bg-card/50 p-4 text-sm text-ink-sub space-y-2">
        <p className="font-medium text-ink">配置说明</p>
        <ul className="list-disc list-inside space-y-1">
          <li>主密钥 <code className="text-ink font-mono">LLM_MASTER_KEY</code> 由 service 的 <code className="text-ink font-mono">.env</code> 提供，丢失或改动会导致已存的 key 无法解密</li>
          <li>Anthropic 走 messages API + tool use 强制结构化输出，准确率最高</li>
          <li>OpenAI 走 chat.completions + response_format json_schema，需要 GPT-4o 或更新模型</li>
          <li>Base URL 留空时使用官方默认；可指向 Azure / 自建中转等兼容 endpoint</li>
        </ul>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-3">
        <span className="text-base font-medium text-ink min-w-[80px]">{label}</span>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
      <div className="pl-[80px] -mt-1">{children}</div>
    </div>
  );
}
