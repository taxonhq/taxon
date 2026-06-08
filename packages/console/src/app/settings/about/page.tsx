"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Tag, Server, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { getHealth, type HealthInfo } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";

const CONSOLE_VERSION = "0.1.0";
const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";

/**
 * 关于（菌丝 v2）—— 原右上角 About 弹窗收口到统一设置面的一个分节。
 * 展示产品标识 / 版本 / 数据库连通性 / API 文档入口。
 */
export default function AboutSettingsPage() {
  const t = useTranslations("about");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getHealth()
      .then(data => { setHealth(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} hint={t("subtitle")} />

      {/* ── 品牌标识 ── */}
      <section className="card-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="w-10 h-10 rounded-xl bg-ink flex items-center justify-center shrink-0 shadow-md">
            <Tag size={15} className="text-surface" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-ink" style={{ letterSpacing: "-0.03em" }}>Taxon</p>
            <p className="text-xs text-ink-faint mt-0.5">{t("subtitle")}</p>
          </div>
        </div>
      </section>

      {/* ── 版本 & 服务 ── */}
      <section className="card-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-edge bg-surface-alt/40">
          <Server size={15} className="text-ink-sub" />
          <h2 className="text-sm font-semibold text-ink">{t("serviceUrl")}</h2>
        </div>
        <div className="p-5">
          <dl className="space-y-3">
            <Row label={t("consoleVersion")} value={`v${CONSOLE_VERSION}`} />
            <Row label={t("serviceVersion")} value={loading ? null : error ? "—" : `v${health?.version ?? "—"}`} loading={loading} />
            <Row label="Node.js" value={loading ? null : error ? "—" : (health?.nodeVersion ?? "—")} loading={loading} />
            <Row label={t("serviceUrl")} value={BASE.replace(/^https?:\/\//, "")} />
            <div className="flex items-center justify-between py-2">
              <dt className="text-xs text-ink-sub">{t("database")}</dt>
              <dd className="flex items-center gap-1.5 text-xs">
                {loading ? (
                  <Loader2 size={12} className="text-ink-faint animate-spin" />
                ) : error || health?.db !== "ok" ? (
                  <span className="flex items-center gap-1.5 text-bad">
                    <XCircle size={12} /> {error ? t("dbUnreachable") : t("dbError")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-ok">
                    <CheckCircle2 size={12} /> {t("dbOk")}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── API 文档 ── */}
      <a
        href={`${BASE}/docs`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between w-full px-5 py-4 rounded-xl card-border hover:bg-surface-alt transition-all group"
      >
        <span className="text-sm font-medium text-ink-dim group-hover:text-ink transition-colors">{t("apiDocs")}</span>
        <ExternalLink size={13} className="text-ink-faint group-hover:text-ink transition-colors" />
      </a>
    </div>
  );
}

function Row({ label, value, loading }: { label: string; value: string | null; loading?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-edge last:border-0">
      <dt className="text-xs text-ink-sub">{label}</dt>
      <dd className="text-xs font-mono text-ink">
        {loading ? <Loader2 size={12} className="text-ink-faint animate-spin" /> : (value ?? "—")}
      </dd>
    </div>
  );
}
