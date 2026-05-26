"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Copy, Check, ShieldCheck } from "lucide-react";
import {
  listTokens, createToken, revokeToken,
  type ApiToken, type CreatedToken,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Button }     from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";

// ── 角色标签样式 — 使用语义 token，自动适配 light/dark ────────────
const ROLE_STYLE: Record<ApiToken["role"], string> = {
  reader:   "bg-brand-1/10 text-brand-1 border-brand-1/25",
  writer:   "bg-ok/10     text-ok     border-ok/25",
  reviewer: "bg-warn/10   text-warn   border-warn/25",
  admin:    "bg-bad/10    text-bad    border-bad/25",
};

const ROLE_LABEL: Record<ApiToken["role"], string> = {
  reader:   "只读",
  writer:   "打标",
  reviewer: "审核",
  admin:    "管理员",
};

// ── 创建 Token 弹窗 ───────────────────────────────────────────────
function CreateDialog({
  onCreated,
  onClose,
}: {
  onCreated: (t: CreatedToken) => void;
  onClose:   () => void;
}) {
  const [name,   setName]   = useState("");
  const [role,   setRole]   = useState<ApiToken["role"]>("writer");
  const [scopes, setScopes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const scopeList = scopes.split(",").map(s => s.trim()).filter(Boolean);
      const t = await createToken({ name: name.trim(), role, scopes: scopeList });
      onCreated(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-surface rounded-xl shadow-xl border border-edge w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-ink mb-4">创建 API Token</h2>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-ink-sub mb-1">名称 <span className="text-bad">*</span></label>
            <input
              className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none focus:ring-1 focus:ring-ink"
              placeholder="restaurant-service"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-ink-sub mb-1">角色</label>
            <select
              className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none"
              value={role}
              onChange={e => setRole(e.target.value as ApiToken["role"])}
            >
              <option value="reader">reader — 只读</option>
              <option value="writer">writer — 注册实体 + 打标</option>
              <option value="reviewer">reviewer — writer + 审核 AI 标签</option>
              <option value="admin">admin — 全权限</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-sub mb-1">entityType 白名单（逗号分隔，留空=全部）</label>
            <input
              className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none"
              placeholder="dish, dining"
              value={scopes}
              onChange={e => setScopes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 创建成功后显示明文 token ──────────────────────────────────────
function TokenRevealDialog({ token, onClose }: { token: CreatedToken; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(token.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-surface rounded-xl shadow-xl border border-edge w-full max-w-lg p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-ok" />
          <h2 className="text-base font-semibold text-ink">Token 已创建</h2>
        </div>
        <p className="text-xs text-ink-sub mb-4">
          请立即复制保存。关闭后将无法再次查看明文。
        </p>
        <div className="flex items-center gap-2 bg-surface-alt border border-edge rounded-lg px-3 py-2 mb-4">
          <code className="flex-1 text-xs font-mono text-ink break-all">{token.token}</code>
          <button
            onClick={copy}
            className="shrink-0 p-1 rounded hover:bg-edge transition-colors text-ink-faint hover:text-ink"
            title="复制"
          >
            {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          </button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>我已保存，关闭</Button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────
export default function TokensPage() {
  const [tokens,     setTokens]     = useState<ApiToken[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [revealed,   setRevealed]   = useState<CreatedToken | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setTokens(await listTokens());
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`确定撤销 "${name}"？撤销后无法恢复。`)) return;
    try {
      await revokeToken(id);
      setTokens(prev => prev.map(t => t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t));
    } catch (e) {
      alert(e instanceof Error ? e.message : "撤销失败");
    }
  }

  function handleCreated(t: CreatedToken) {
    setShowCreate(false);
    setRevealed(t);
    setTokens(prev => [t, ...prev]);
  }

  const active  = tokens.filter(t => !t.revokedAt);
  const revoked = tokens.filter(t =>  t.revokedAt);

  return (
    <>
      <PageHeader
        title="API Tokens"
        description="管理服务级 API Key 及其权限角色"
        action={
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            创建 Token
          </Button>
        }
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-sm text-ink-faint">加载中…</p>
      ) : (
        <div className="space-y-8">
          {/* 有效 Tokens */}
          <section>
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-widest mb-3">
              有效 ({active.length})
            </h3>
            {active.length === 0 ? (
              <p className="text-sm text-ink-faint">暂无有效 Token</p>
            ) : (
              <div className="divide-y divide-edge border border-edge rounded-xl overflow-hidden">
                {active.map(t => (
                  <TokenRow key={t.id} token={t} onRevoke={() => handleRevoke(t.id, t.name)} />
                ))}
              </div>
            )}
          </section>

          {/* 已撤销 Tokens */}
          {revoked.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-widest mb-3">
                已撤销 ({revoked.length})
              </h3>
              <div className="divide-y divide-edge border border-edge rounded-xl overflow-hidden opacity-50">
                {revoked.map(t => (
                  <TokenRow key={t.id} token={t} revoked />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showCreate && (
        <CreateDialog onCreated={handleCreated} onClose={() => setShowCreate(false)} />
      )}
      {revealed && (
        <TokenRevealDialog token={revealed} onClose={() => setRevealed(null)} />
      )}
    </>
  );
}

// ── Token 行 ──────────────────────────────────────────────────────
function TokenRow({
  token,
  revoked = false,
  onRevoke,
}: {
  token:    ApiToken;
  revoked?: boolean;
  onRevoke?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-surface hover:bg-surface-alt transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-ink truncate">{token.name}</span>
          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${ROLE_STYLE[token.role]}`}>
            {ROLE_LABEL[token.role]}
          </span>
          {token.scopes.length > 0 && (
            <span className="text-2xs text-ink-faint font-mono">
              {token.scopes.join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-faint">
          <span>创建 {fmt(token.createdAt)}</span>
          {token.lastUsedAt && <span>上次使用 {fmt(token.lastUsedAt)}</span>}
          {token.revokedAt  && <span className="text-bad">已撤销 {fmt(token.revokedAt)}</span>}
        </div>
      </div>
      {!revoked && onRevoke && (
        <button
          onClick={onRevoke}
          className="shrink-0 p-1.5 rounded-lg text-ink-faint hover:text-bad hover:bg-bad/10 transition-colors"
          title="撤销"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric",
    hour: "2-digit",  minute: "2-digit",
  });
}
