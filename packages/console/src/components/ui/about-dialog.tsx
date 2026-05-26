"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink, Tag, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { getHealth, type HealthInfo } from "@/lib/api";

const CONSOLE_VERSION = "0.1.0";
const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: Props) {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />

      {/* Panel */}
      <div
        className="relative w-[400px] bg-overlay border border-edge rounded-2xl shadow-2xl shadow-black/40 animate-scale-in overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent line */}
        <div className="absolute top-0 left-10 right-10 h-px bg-gradient-to-r from-transparent via-edge-strong to-transparent" />

        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-5">
          <div className="w-9 h-9 rounded-xl bg-ink flex items-center justify-center shrink-0 shadow-md">
            <Tag size={14} className="text-surface" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-ink" style={{ letterSpacing: "-0.03em" }}>Taxon</p>
            <p className="text-xs text-ink-faint mt-0.5">标签微服务管理控制台</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-edge mx-6" />

        {/* Content */}
        <div className="px-6 py-5 space-y-4">

          {/* Version rows */}
          <div className="space-y-2.5">
            <Row label="控制台版本" value={`v${CONSOLE_VERSION}`} mono />
            <Row
              label="服务版本"
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

          {/* Divider */}
          <div className="h-px bg-edge" />

          {/* Service info */}
          <div className="space-y-2.5">
            <Row label="服务地址" value={BASE.replace(/^https?:\/\//, "")} mono />
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-faint">数据库</span>
              {loading ? (
                <Loader2 size={12} className="text-ink-faint animate-spin" />
              ) : error ? (
                <span className="flex items-center gap-1.5 text-sm text-bad">
                  <XCircle size={12} /> 无法连接
                </span>
              ) : health?.db === "ok" ? (
                <span className="flex items-center gap-1.5 text-sm text-ok">
                  <CheckCircle2 size={12} /> 正常
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-bad">
                  <XCircle size={12} /> 异常
                </span>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-edge" />

          {/* API Docs link */}
          <a
            href={`${BASE}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between w-full px-3.5 py-2.5 rounded-lg border border-edge hover:border-edge-strong hover:bg-surface-alt transition-all group"
          >
            <span className="text-base font-medium text-ink-dim group-hover:text-ink transition-colors">
              API 接口文档
            </span>
            <ExternalLink size={12} className="text-ink-faint group-hover:text-ink transition-colors" />
          </a>
        </div>
      </div>
    </div>
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
