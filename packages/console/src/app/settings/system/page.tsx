"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Globe, Server, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { getSystemConfig, updateSystemConfig, getHealth, type SystemConfig } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { toast } from "@/components/ui/toast";

const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";

type HealthStatus = "ok" | "degraded" | "checking";

export default function SystemSettingsPage() {
  const t = useTranslations("system");
  const tCommon = useTranslations("common");

  const [locale,   setLocale]   = useState<SystemConfig["locale"]>("zh-CN");
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [health,   setHealth]   = useState<HealthStatus>("checking");
  const [version,  setVersion]  = useState<string>("—");

  // Load current config
  useEffect(() => {
    getSystemConfig()
      .then(cfg => { setLocale(cfg.locale); setLoading(false); })
      .catch(() => { setError(t("loadFailed")); setLoading(false); });
  }, [t]);

  // Health + version check
  useEffect(() => {
    getHealth()
      .then(h => {
        setHealth(h.status === "ok" ? "ok" : "degraded");
        setVersion(h.version ?? "—");
      })
      .catch(() => setHealth("degraded"));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateSystemConfig({ locale });
      // Persist in cookie for immediate client-side effect (no URL change needed)
      document.cookie = `taxon-locale=${locale}; path=/; max-age=${365 * 24 * 3600}; SameSite=Lax`;
      toast.success(t("saveSuccess"));
      // Brief delay so the toast is visible before the page reloads with the new locale
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const LOCALES: { value: SystemConfig["locale"]; label: string; native: string }[] = [
    { value: "zh-CN", label: t("localeZh"), native: "简体中文" },
    { value: "en-US", label: t("localeEn"), native: "English"  },
  ];

  const healthIcon =
    health === "ok"       ? <CheckCircle2 size={13} className="text-ok" /> :
    health === "degraded" ? <AlertCircle  size={13} className="text-bad" /> :
    <Loader2 size={13} className="text-ink-faint animate-spin" />;

  const healthLabel =
    health === "ok"       ? t("serviceOk") :
    health === "degraded" ? t("serviceDegraded") :
    t("serviceChecking");

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <ErrorBanner message={error} />

      {/* ── Appearance & Language ── */}
      <section className="card-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-edge bg-surface-alt/40">
          <Globe size={15} className="text-ink-sub" />
          <h2 className="text-sm font-semibold text-ink">{t("appearanceSection")}</h2>
        </div>

        <div className="p-5 space-y-5">
          {/* Locale selector */}
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-ink-sub mb-2">{t("localeLabel")}</label>
              {loading ? (
                <div className="h-9 w-48 bg-surface-alt rounded-lg animate-pulse" />
              ) : (
                <div className="flex gap-2">
                  {LOCALES.map(loc => (
                    <button
                      key={loc.value}
                      onClick={() => setLocale(loc.value)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-all ${
                        locale === loc.value
                          ? "border-brand-1 bg-brand-1/8 text-ink font-medium"
                          : "border-edge-mid bg-input text-ink-dim hover:border-edge-strong hover:text-ink"
                      }`}
                    >
                      <span className="text-base leading-none">
                        {loc.value === "zh-CN" ? "🇨🇳" : "🇺🇸"}
                      </span>
                      <span>{loc.native}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-ink-faint mt-2">
                {t("reloadHint")}
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={handleSave} loading={saving} disabled={loading}>
              {tCommon("save")}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Service Info ── */}
      <section className="card-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-edge bg-surface-alt/40">
          <Server size={15} className="text-ink-sub" />
          <h2 className="text-sm font-semibold text-ink">{t("serviceInfoSection")}</h2>
        </div>

        <div className="p-5">
          <dl className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-edge last:border-0">
              <dt className="text-xs text-ink-sub">{t("serviceUrl")}</dt>
              <dd className="text-xs font-mono text-ink">{BASE}</dd>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-edge last:border-0">
              <dt className="text-xs text-ink-sub">{t("serviceVersion")}</dt>
              <dd className="text-xs font-mono text-ink">{version}</dd>
            </div>
            <div className="flex items-center justify-between py-2">
              <dt className="text-xs text-ink-sub">{t("serviceStatus")}</dt>
              <dd className="flex items-center gap-1.5 text-xs">
                {healthIcon}
                <span className={health === "ok" ? "text-ok" : health === "degraded" ? "text-bad" : "text-ink-faint"}>
                  {healthLabel}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
