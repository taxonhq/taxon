"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Copy, Check, ShieldCheck, Code2, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  listTokens, createToken, revokeToken,
  type ApiToken, type CreatedToken,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Button }     from "@/components/ui/button";
import { Dialog }     from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  open,
  onCreated,
  onClose,
}: {
  open:      boolean;
  onCreated: (tk: CreatedToken) => void;
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
    <Dialog open={open} onClose={onClose} title={t("createTitle")} size="sm">
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit} className="space-y-4 mt-2">
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
    </Dialog>
  );
}

// ── Token reveal dialog ──────────────────────────────────────────
function TokenRevealDialog({ token, onClose }: { token: CreatedToken | null; onClose: () => void }) {
  const t = useTranslations("tokens");
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!token) return;
    navigator.clipboard.writeText(token.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      open={token !== null}
      onClose={onClose}
      title={t("tokenCreated")}
      size="md"
    >
      <div className="flex items-center gap-2 mb-1 -mt-1">
        <ShieldCheck size={16} className="text-ok shrink-0" />
        <p className="text-xs text-ink-sub">{t("tokenRevealDesc")}</p>
      </div>
      <div className="flex items-center gap-2 bg-surface-alt border border-edge rounded-lg px-3 py-2 my-4">
        <code className="flex-1 text-xs font-mono text-ink break-all">{token?.token}</code>
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
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function TokensPage() {
  const t = useTranslations("tokens");
  const tCommon = useTranslations("common");

  const [tokens,        setTokens]        = useState<ApiToken[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [showCreate,    setShowCreate]    = useState(false);
  const [revealed,      setRevealed]      = useState<CreatedToken | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: string; name: string } | null>(null);

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

  function handleRevoke(id: string, name: string) {
    setConfirmRevoke({ id, name });
  }

  async function doRevoke() {
    if (!confirmRevoke) return;
    const { id } = confirmRevoke;
    setConfirmRevoke(null);
    try {
      await revokeToken(id);
      setTokens(prev => prev.map(tk => tk.id === id ? { ...tk, revokedAt: new Date().toISOString() } : tk));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("revokeFailed"));
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
        hint={t("description")}
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

      {/* API Usage Guide */}
      <ApiGuide />

      <CreateDialog
        open={showCreate}
        onCreated={handleCreated}
        onClose={() => setShowCreate(false)}
      />
      <TokenRevealDialog token={revealed} onClose={() => setRevealed(null)} />
      <ConfirmDialog
        open={confirmRevoke !== null}
        title={t("revokeToken")}
        description={confirmRevoke ? t("revokeConfirm", { name: confirmRevoke.name }) : ""}
        confirmLabel={t("revokeToken")}
        danger
        onConfirm={doRevoke}
        onCancel={() => setConfirmRevoke(null)}
      />
    </>
  );
}

// ── API Usage Guide ───────────────────────────────────────────────
const BASE_URL = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";

function ApiGuide() {
  const t = useTranslations("tokens");
  const ROLES: Array<{ role: ApiToken["role"]; desc: string }> = [
    { role: "reader",   desc: t("roleDescReader") },
    { role: "writer",   desc: t("roleDescWriter") },
    { role: "reviewer", desc: t("roleDescReviewer") },
    { role: "admin",    desc: t("roleDescAdmin") },
  ];
  return (
    <section className="card-border rounded-xl overflow-hidden mt-4">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-edge bg-surface-alt/40">
        <Code2 size={15} className="text-ink-sub" />
        <h3 className="text-sm font-semibold text-ink">{t("apiGuideTitle")}</h3>
        <a
          href={`${BASE_URL}/docs`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-xs text-brand-1 hover:underline"
        >
          {t("openApiDocs")} <ExternalLink size={10} />
        </a>
      </div>
      <div className="p-5 space-y-5">
        {/* Auth header example */}
        <div>
          <p className="text-xs font-medium text-ink-sub mb-2">{t("authHeaderLabel")}</p>
          <div className="bg-surface-alt rounded-lg border border-edge px-4 py-3 font-mono text-xs text-ink-dim leading-relaxed">
            <span className="text-ink-faint">Authorization: </span>
            <span className="text-ok">Bearer</span>
            <span className="text-warn"> {"<your-token>"}</span>
          </div>
        </div>
        {/* Role reference */}
        <div>
          <p className="text-xs font-medium text-ink-sub mb-2">{t("rolesLabel")}</p>
          <div className="divide-y divide-edge border border-edge rounded-lg overflow-hidden">
            {ROLES.map(({ role, desc }) => (
              <div key={role} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border shrink-0 ${ROLE_STYLE[role]}`}>
                  {role}
                </span>
                <span className="text-xs text-ink-sub">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
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
