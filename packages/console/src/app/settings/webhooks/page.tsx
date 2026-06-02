"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Copy, Check, KeyRound, ListChecks, RotateCcw, RefreshCw, Pause, Play, Webhook as WebhookIcon } from "lucide-react";
import {
  listWebhooks, createWebhook, updateWebhook, deleteWebhook,
  getWebhookDeliveries, replayWebhookDelivery,
  WEBHOOK_EVENTS, type Webhook, type CreatedWebhook, type WebhookDelivery,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { toast } from "@/components/ui/toast";

// 事件按前缀分组，便于勾选
const EVENT_GROUPS: Record<string, readonly string[]> = {
  entity_tag: WEBHOOK_EVENTS.filter(e => e.startsWith("entity_tag.")),
  tag:        WEBHOOK_EVENTS.filter(e => e.startsWith("tag.")),
  tag_group:  WEBHOOK_EVENTS.filter(e => e.startsWith("tag_group.")),
  entity:     WEBHOOK_EVENTS.filter(e => e.startsWith("entity.") && !e.startsWith("entity_tag.")),
};

function fmt(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── 创建对话框 ────────────────────────────────────────────────────
function CreateDialog({ open, onCreated, onClose }: {
  open: boolean; onCreated: (w: CreatedWebhook) => void; onClose: () => void;
}) {
  const t = useTranslations("webhooks");
  const tCommon = useTranslations("common");
  const [name, setName]     = useState("");
  const [url, setUrl]       = useState("");
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [scopes, setScopes] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  function reset() { setName(""); setUrl(""); setEvents(new Set()); setScopes(""); setSecret(""); setError(""); }
  function toggle(ev: string) {
    setEvents(prev => { const n = new Set(prev); if (n.has(ev)) n.delete(ev); else n.add(ev); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || events.size === 0) return;
    setSaving(true); setError("");
    try {
      const created = await createWebhook({
        name: name.trim(), url: url.trim(),
        events: [...events],
        scopes: scopes.split(",").map(s => s.trim()).filter(Boolean),
        secret: secret.trim() || undefined,
      });
      reset();
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("createTitle")} size="lg">
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit} className="space-y-4 mt-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-sub mb-1">{t("nameLabel")} <span className="text-bad">*</span></label>
            <input className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none focus:border-edge-strong"
              placeholder={t("namePlaceholder")} value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs text-ink-sub mb-1">{t("scopesLabel")}</label>
            <input className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt focus:outline-none"
              placeholder={t("scopesPlaceholder")} value={scopes} onChange={e => setScopes(e.target.value)} />
            <p className="text-2xs text-ink-faint mt-1">{t("scopesHint")}</p>
          </div>
        </div>
        <div>
          <label className="block text-xs text-ink-sub mb-1">{t("urlLabel")} <span className="text-bad">*</span></label>
          <input type="url" className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt font-mono focus:outline-none focus:border-edge-strong"
            placeholder={t("urlPlaceholder")} value={url} onChange={e => setUrl(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs text-ink-sub mb-1.5">{t("eventsLabel")} <span className="text-bad">*</span> <span className="text-ink-faint font-normal">· {t("eventsHint")}</span></label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 border border-edge rounded-lg p-3 bg-surface-alt/40">
            {Object.entries(EVENT_GROUPS).map(([grp, evs]) => (
              <div key={grp} className="space-y-1">
                <p className="text-2xs font-mono text-ink-faint uppercase tracking-wide">{grp}</p>
                {evs.map(ev => (
                  <label key={ev} className="flex items-center gap-2 text-xs text-ink cursor-pointer hover:text-ink">
                    <input type="checkbox" className="size-3.5" checked={events.has(ev)} onChange={() => toggle(ev)} />
                    <span className="font-mono">{ev.split(".")[1]}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-ink-sub mb-1">{t("secretLabel")}</label>
          <input className="w-full border border-edge rounded-lg px-3 py-2 text-sm text-ink bg-surface-alt font-mono focus:outline-none"
            placeholder="whsec_…" value={secret} onChange={e => setSecret(e.target.value)} />
          <p className="text-2xs text-ink-faint mt-1">{t("secretHint")}</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>{tCommon("cancel")}</Button>
          <Button type="submit" disabled={saving || !name.trim() || !url.trim() || events.size === 0}>
            {saving ? tCommon("creating") : tCommon("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── secret 揭示 ───────────────────────────────────────────────────
function SecretRevealDialog({ webhook, onClose }: { webhook: CreatedWebhook | null; onClose: () => void }) {
  const t = useTranslations("webhooks");
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!webhook) return;
    navigator.clipboard.writeText(webhook.secret);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Dialog open={webhook !== null} onClose={onClose} title={t("secretCreated")} size="md">
      <div className="flex items-center gap-2 mb-1 -mt-1">
        <KeyRound size={16} className="text-ok shrink-0" />
        <p className="text-xs text-ink-sub">{t("secretRevealDesc")}</p>
      </div>
      <div className="flex items-center gap-2 bg-surface-alt border border-edge rounded-lg px-3 py-2 my-4">
        <code className="flex-1 text-xs font-mono text-ink break-all">{webhook?.secret}</code>
        <button onClick={copy} className="shrink-0 p-1 rounded hover:bg-edge transition-colors text-ink-faint hover:text-ink" title={t("copySecret")}>
          {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
        </button>
      </div>
      <div className="flex justify-end"><Button onClick={onClose}>{t("saveAndClose")}</Button></div>
    </Dialog>
  );
}

// ── 投递记录对话框 ────────────────────────────────────────────────
const STATUS_STYLE: Record<WebhookDelivery["status"], string> = {
  success: "bg-ok/10 text-ok border-ok/25",
  pending: "bg-warn/10 text-warn border-warn/25",
  failed:  "bg-bad/10 text-bad border-bad/25",
};

function DeliveriesDialog({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const t = useTranslations("webhooks");
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!webhook) return;
    setLoading(true);
    try { setRows(await getWebhookDeliveries(webhook.id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "load failed"); }
    finally { setLoading(false); }
  }, [webhook]);

  useEffect(() => { if (webhook) { setRows(null); load(); } }, [webhook, load]);

  async function replay(d: WebhookDelivery) {
    if (!webhook) return;
    try {
      await replayWebhookDelivery(webhook.id, d.id);
      toast.success(t("deliveryReplayed"));
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "replay failed"); }
  }

  const statusLabel = (s: WebhookDelivery["status"]) =>
    s === "success" ? t("deliveryStatusSuccess") : s === "pending" ? t("deliveryStatusPending") : t("deliveryStatusFailed");

  return (
    <Dialog open={webhook !== null} onClose={onClose} title={webhook ? t("deliveriesTitle", { name: webhook.name }) : ""} size="lg">
      <div className="flex justify-end -mt-1 mb-2">
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {t("refresh")}
        </Button>
      </div>
      {loading && rows === null ? (
        <p className="text-sm text-ink-faint py-6 text-center">…</p>
      ) : rows && rows.length === 0 ? (
        <p className="text-sm text-ink-faint py-6 text-center">{t("noDeliveries")}</p>
      ) : (
        <div className="divide-y divide-edge border border-edge rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
          {rows?.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-xs">
              <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border shrink-0 ${STATUS_STYLE[d.status]}`}>{statusLabel(d.status)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-ink truncate">{d.event}</div>
                <div className="text-ink-faint flex items-center gap-2">
                  <span>{fmt(d.createdAt)}</span>
                  <span>· {t("deliveryAttempts", { n: d.attempts })}</span>
                  {d.responseCode != null && <span>· {t("deliveryResponseCode", { code: d.responseCode })}</span>}
                </div>
              </div>
              {d.status !== "success" && (
                <button onClick={() => replay(d)} className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors" title={t("deliveryReplay")}>
                  <RotateCcw size={12} /> {t("deliveryReplay")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────
export default function WebhooksPage() {
  const t = useTranslations("webhooks");
  const tCommon = useTranslations("common");

  const [hooks, setHooks]       = useState<Webhook[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [showCreate, setShowCreate]   = useState(false);
  const [revealed, setRevealed] = useState<CreatedWebhook | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Webhook | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setHooks(await listWebhooks()); }
    catch (e) { setError(e instanceof Error ? e.message : tCommon("loadError")); }
    finally { setLoading(false); }
  }, [tCommon]);

  useEffect(() => { load(); }, [load]);

  function handleCreated(w: CreatedWebhook) {
    setShowCreate(false);
    setRevealed(w);
    setHooks(prev => [w, ...prev]);
  }

  async function toggleActive(w: Webhook) {
    try {
      const next = await updateWebhook(w.id, { active: !w.active });
      setHooks(prev => prev.map(h => h.id === w.id ? next : h));
    } catch (e) { toast.error(e instanceof Error ? e.message : "update failed"); }
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const w = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteWebhook(w.id);
      setHooks(prev => prev.filter(h => h.id !== w.id));
    } catch (e) { toast.error(e instanceof Error ? e.message : t("deleteFailed")); }
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        hint={t("description")}
        action={<Button onClick={() => setShowCreate(true)}><Plus size={14} />{t("create")}</Button>}
      />

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-sm text-ink-faint">{tCommon("loading")}</p>
      ) : hooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <WebhookIcon size={28} className="text-ink-faint mb-3" strokeWidth={1.4} />
          <p className="text-sm font-medium text-ink">{t("noWebhooks")}</p>
          <p className="text-xs text-ink-faint mt-1 max-w-xs">{t("noWebhooksDesc")}</p>
        </div>
      ) : (
        <div className="divide-y divide-edge border border-edge rounded-xl overflow-hidden">
          {hooks.map(w => {
            const lf = fmt(w.lastFiredAt);
            return (
              <div key={w.id} className={`flex items-center gap-4 px-4 py-3 bg-surface hover:bg-surface-alt transition-colors ${w.active ? "" : "opacity-55"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-ink truncate">{w.name}</span>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border shrink-0 ${w.active ? "bg-ok/10 text-ok border-ok/25" : "bg-edge text-ink-faint border-edge"}`}>
                      {w.active ? t("active") : t("paused")}
                    </span>
                  </div>
                  <div className="text-xs text-ink-faint font-mono truncate">{w.url}</div>
                  <div className="flex items-center gap-2 text-2xs text-ink-faint mt-0.5">
                    <span>{t("eventsCount", { count: w.events.length })}</span>
                    <span>· {w.scopes.length > 0 ? w.scopes.join(", ") : t("allTypes")}</span>
                    <span>· {lf ? `${t("lastFired")} ${lf}` : t("neverFired")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => setDeliveriesFor(w)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors text-xs" title={t("viewDeliveries")}>
                    <ListChecks size={14} /> {t("viewDeliveries")}
                  </button>
                  <button onClick={() => toggleActive(w)} className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors" title={w.active ? t("pause") : t("enable")}>
                    {w.active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button onClick={() => setConfirmDelete(w)} className="p-1.5 rounded-lg text-ink-faint hover:text-bad hover:bg-bad/10 transition-colors" title={t("delete")}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-2xs text-ink-faint mt-4 max-w-2xl leading-relaxed">{t("signatureGuide")}</p>

      <CreateDialog open={showCreate} onCreated={handleCreated} onClose={() => setShowCreate(false)} />
      <SecretRevealDialog webhook={revealed} onClose={() => setRevealed(null)} />
      <DeliveriesDialog webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete ? t("deleteTitle", { name: confirmDelete.name }) : ""}
        description={t("deleteConfirm")}
        confirmLabel={t("delete")}
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
