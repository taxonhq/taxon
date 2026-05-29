"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Tag, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { getHealth, type HealthInfo } from "@/lib/api";
import { Dialog } from "./dialog";

const CONSOLE_VERSION = "0.1.0";
const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: Props) {
  const t = useTranslations("about");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(false);
    getHealth()
      .then(data => { setHealth(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} size="sm" showClose={false}>
      {/* 自定义 header — 带品牌 chip + 关闭按钮 */}
      <div className="flex items-center gap-3 -mx-6 -mt-6 px-6 pt-6 pb-5 border-b border-edge">
        <div className="w-9 h-9 rounded-xl bg-ink flex items-center justify-center shrink-0 shadow-md">
          <Tag size={14} className="text-surface" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-ink" style={{ letterSpacing: "-0.03em" }}>Taxon</p>
          <p className="text-xs text-ink-faint mt-0.5">{t("subtitle")}</p>
        </div>
      </div>

      <div className="space-y-4 pt-4">
        {/* Version rows */}
        <div className="space-y-2.5">
          <Row label={t("consoleVersion")} value={`v${CONSOLE_VERSION}`} mono />
          <Row
            label={t("serviceVersion")}
            value={loading ? null : error ? "—" : `v${health?.version ?? "—"}`}
            mono
            loading={loading}
          />
          <Row
            label="Node.js"
            value={loading ? null : error ? "—" : (health?.nodeVersion ?? "—")}
            mono
            loading={loading}
          />
        </div>

        <div className="h-px bg-edge" />

        {/* Service info */}
        <div className="space-y-2.5">
          <Row label={t("serviceUrl")} value={BASE.replace(/^https?:\/\//, "")} mono />
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-faint">{t("database")}</span>
            {loading ? (
              <Loader2 size={12} className="text-ink-faint animate-spin" />
            ) : error ? (
              <span className="flex items-center gap-1.5 text-sm text-bad">
                <XCircle size={12} /> {t("dbUnreachable")}
              </span>
            ) : health?.db === "ok" ? (
              <span className="flex items-center gap-1.5 text-sm text-ok">
                <CheckCircle2 size={12} /> {t("dbOk")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-bad">
                <XCircle size={12} /> {t("dbError")}
              </span>
            )}
          </div>
        </div>

        <div className="h-px bg-edge" />

        {/* API Docs link */}
        <a
          href={`${BASE}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-lg border border-edge hover:border-edge-strong hover:bg-surface-alt transition-all group"
        >
          <span className="text-base font-medium text-ink-dim group-hover:text-ink transition-colors">
            {t("apiDocs")}
          </span>
          <ExternalLink size={12} className="text-ink-faint group-hover:text-ink transition-colors" />
        </a>
      </div>
    </Dialog>
  );
}

function Row({
  label, value, mono, loading,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-ink-faint">{label}</span>
      {loading ? (
        <Loader2 size={12} className="text-ink-faint animate-spin" />
      ) : (
        <span className={`text-sm text-ink ${mono ? "font-mono" : ""}`}>
          {value ?? "—"}
        </span>
      )}
    </div>
  );
}
