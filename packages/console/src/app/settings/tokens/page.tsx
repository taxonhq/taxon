"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Copy, Check, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  listTokens, createToken, revokeToken,
  type ApiToken, type CreatedToken,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Button }     from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";

// ── Role badge styles ─────────────────────────────────────────────
const ROLE_STYLE: Record<ApiToken["role"], string> = {
  reader:   "bg-brand-1/10 text-brand-1 border-brand-1/25",
  writer:   "bg-ok/10     text-ok     border-ok/25",
  reviewer: "bg-warn/10   text-warn   border-warn/25",
  admin:    "bg-bad/10    text-bad    border-bad/25",
};

// ── Create Token dialog ────────────────────────────────────────────
function CreateDialog({
  onCreated,
  onClose,
}: {
  onCreated: (t: CreatedToken) => void;
  onClose:   () => void;
}) {
  const t = useTranslations("tokens");
  const tCommon = useTranslations("common");
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
      const created = await createToken({ name: name.trim(), role, scopes: scopeList });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-surface rounded-xl shadow-xl border border-edge w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-ink mb-4">{t("createTitle")}</h2>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-ink-sub mb-1">{t("nameLabel")} <span className="text-bad">*</span></label>
            <input
              className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-brand-1/40"
              placeholder="restaurant-service"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-ink-sub mb-1">{t("roleLabel")}</label>
            <select
              className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none"
              value={role}
              onChange={e => setRole(e.target.value as ApiToken["role"])}
            >
              <option value="reader">{t("roleReader")}</option>
              <option value="writer">{t("roleWriter")}</option>
              <option value="reviewer">{t("roleReviewer")}</option>
              <option value="admin">{t("roleAdmin")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-sub mb-1">{t("scopeLabel")}</label>
            <input
              className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none"
              placeholder={t("scopePlaceholder")}
              value={scopes}
              onChange={e => setScopes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>{tCommon("cancel")}</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? tCommon("creating") : tCommon("create")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Token reveal dialog ──────────────────────────────────────────
function TokenRevealDialog({ token, onClose }: { token: CreatedToken; onClose: () => void }) {
  const t = useTranslations("tokens");
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
          <h2 className="text-base font-semibold text-ink">{t("tokenCreated")}</h2>
        </div>
        <p className="text-xs text-ink-sub mb-4">{t("tokenRevealDesc")}</p>
        <div className="flex items-center gap-2 bg-surface-alt border border-edge rounded-lg px-3 py-2 mb-4">
          <code className="flex-1 text-xs font-mono text-ink break-all">{token.token}</code>
          <button
            onClick={copy}
            className="shrink-0 p-1 rounded hover:bg-edge transition-colors text-ink-faint hover:text-ink"
            aria-label={t("copyToken")}
            title={t("copyToken")}
          >
            {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
          </button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t("saveAndClose")}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function TokensPage() {
  const t = useTranslations("tokens");
  const tCommon = useTranslations("common");

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
      setError(e instanceof Error ? e.message : tCommon("loadError"));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(id: string, name: string) {
    if (!window.confirm(t("revokeConfirm", { name }))) return;
    try {
      await revokeToken(id);
      setTokens(prev => prev.map(tk => tk.id === id ? { ...tk, revokedAt: new Date().toISOString() } : tk));
    } catch (e) {
      alert(e instanceof Error ? e.message : t("revokeFailed"));
    }
  }

  function handleCreated(created: CreatedToken) {
    setShowCreate(false);
    setRevealed(created);
    setTokens(prev => [created, ...prev]);
  }

  const active  = tokens.filter(tk => !tk.revokedAt);
  const revoked = tokens.filter(tk =>  tk.revokedAt);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={14} />
            {t("createToken")}
          </Button>
        }
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-sm text-ink-faint">{tCommon("loading")}</p>
      ) : (
        <div className="space-y-8">
          {/* Active tokens */}
          <section>
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-widest mb-3">
              {t("activeTokens")} ({active.length})
            </h3>
            {active.length === 0 ? (
              <p className="text-sm text-ink-faint">{t("noTokens")}</p>
            ) : (
              <div className="divide-y divide-edge border border-edge rounded-xl overflow-hidden">
                {active.map(tk => (
                  <TokenRow key={tk.id} token={tk} onRevoke={() => handleRevoke(tk.id, tk.name)} />
                ))}
              </div>
            )}
          </section>

          {/* Revoked tokens */}
          {revoked.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-widest mb-3">
                {t("revokedTokens")} ({revoked.length})
              </h3>
              <div className="divide-y divide-edge border border-edge rounded-xl overflow-hidden opacity-50">
                {revoked.map(tk => (
                  <TokenRow key={tk.id} token={tk} revoked />
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

// ── Token row ─────────────────────────────────────────────────────
function TokenRow({
  token,
  revoked = false,
  onRevoke,
}: {
  token:    ApiToken;
  revoked?: boolean;
  onRevoke?: () => void;
}) {
  const t = useTranslations("tokens");
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-surface hover:bg-surface-alt transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-ink truncate">{token.name}</span>
          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${ROLE_STYLE[token.role]}`}>
            {t(`roleBadge${token.role.charAt(0).toUpperCase()}${token.role.slice(1)}` as Parameters<typeof t>[0])}
          </span>
          {token.scopes.length > 0 && (
            <span className="text-2xs text-ink-faint font-mono">
              {token.scopes.join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-faint">
          <span>{t("createdBy")} {fmt(token.createdAt)}</span>
          {token.lastUsedAt && <span>{t("lastUsed")} {fmt(token.lastUsedAt)}</span>}
          {token.revokedAt  && <span className="text-bad">{t("revoked")} {fmt(token.revokedAt)}</span>}
        </div>
      </div>
      {!revoked && onRevoke && (
        <button
          onClick={onRevoke}
          className="shrink-0 p-1.5 rounded-lg text-ink-faint hover:text-bad hover:bg-bad/10 transition-colors"
          aria-label={t("revokeToken")}
          title={t("revokeToken")}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "numeric", day: "numeric",
    hour: "2-digit",  minute: "2-digit",
  });
}
