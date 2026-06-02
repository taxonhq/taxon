"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Box, ChevronRight, X, List, Share2 } from "lucide-react";
import { getEntityTypes, registerEntity } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { EntityGraph } from "@/components/entities/entity-graph";
import { groupColor } from "@/lib/group-color";

interface EntityTypeStat {
  entityType: string;
  count: number;
}

export default function EntitiesPage() {
  const t = useTranslations("entities");
  const tCommon = useTranslations("common");

  const [types, setTypes]         = useState<EntityTypeStat[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState({ entityType: "", entityId: "" });
  const [view, setView]           = useState<"list" | "graph">("list");
  const [graphType, setGraphType] = useState("");
  const [mounted, setMounted]     = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const load = async () => {
    setError("");
    try {
      const data = await getEntityTypes();
      setTypes(data);
    } catch (err) {
      setError(err instanceof Error ? tCommon("loadErrorMsg", { message: err.message }) : tCommon("loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 图谱默认聚焦实体最多的类型
  useEffect(() => {
    if (types.length > 0 && !graphType) {
      setGraphType([...types].sort((a, b) => b.count - a.count)[0].entityType);
    }
  }, [types, graphType]);
  // 全视口图谱：Esc 退回列表
  useEffect(() => {
    if (view !== "graph") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setView("list"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.entityType.trim() || !form.entityId.trim()) {
      setError(t("entityTypeRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await registerEntity(form.entityType.trim(), form.entityId.trim());
      setForm({ entityType: "", entityId: "" });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("registerFailed"));
    } finally {
      setSaving(false);
    }
  };

  const knownTypes = types.map(t => t.entityType);
  const totalEntities = types.reduce((s, t) => s + t.count, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title={t("title")}
        hint={t("description")}
        action={
          <Button size="sm" onClick={() => setShowForm(v => !v)}>
            <Plus size={13} />
            {t("registerEntity")}
          </Button>
        }
      />

      <ErrorBanner message={error} />

      {/* Register form */}
      {showForm && (
        <div className="card-border overflow-hidden p-5 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-md font-semibold text-ink">{t("registerTitle")}</p>
              <p className="text-sm text-ink-sub mt-0.5">{t("registerDesc")}</p>
            </div>
            <button onClick={() => setShowForm(false)} className="p-1.5 text-ink-faint hover:text-ink transition-colors rounded-lg hover:bg-surface-alt">
              <X size={14} />
            </button>
          </div>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("entityTypeLabel")} required hint={t("entityTypeHint")}>
                <Combobox
                  value={form.entityType}
                  onChange={v => setForm(f => ({ ...f, entityType: v }))}
                  options={knownTypes}
                  placeholder={t("entityTypePlaceholder")}
                />
              </Field>
              <Field label={t("entityIdLabel")} required hint={t("entityIdHint")}>
                <Input
                  value={form.entityId}
                  onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                  placeholder={t("entityIdPlaceholder")}
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>{tCommon("cancel")}</Button>
              <Button type="submit" size="sm" loading={saving}>{t("registerEntity")}</Button>
            </div>
          </form>
        </div>
      )}

      {/* Summary strip + 视图切换 */}
      {!loading && types.length > 0 && (
        <div className="flex items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-edge bg-surface-alt/40 text-xs text-ink-sub">
            <span className="font-semibold text-ink">{types.length}</span>
            {t("entityTypeCount", { count: types.length })}
            <span className="text-edge-strong">·</span>
            <span className="font-semibold text-ink">
              {totalEntities.toLocaleString()}
            </span>
            {t("totalEntitiesCount")}
          </div>
          {/* 列表 / 图谱 切换 */}
          <div className="flex items-center gap-0.5 p-1 rounded-lg bg-surface-alt border border-edge shrink-0">
            <ViewTab active={view === "list"} onClick={() => setView("list")} icon={List} label={t("viewList")} />
            <ViewTab active={view === "graph"} onClick={() => setView("graph")} icon={Share2} label={t("viewGraph")} />
          </div>
        </div>
      )}

      {/* 内容：列表卡片 / 关系图谱 */}
      {loading ? (
        <SkeletonGrid />
      ) : types.length === 0 ? (
        <EmptyEntities onRegister={() => setShowForm(true)} />
      ) : view === "list" ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {types.map((type, i) => {
            const share   = totalEntities > 0 ? (type.count / totalEntities) * 100 : 0;
            const barPct  = share > 0 ? Math.max(2, share) : 0;
            const accent  = groupColor(type.entityType);
            return (
              <Link
                key={type.entityType}
                href={`/entities/${encodeURIComponent(type.entityType)}`}
                className="card-border overflow-hidden p-4 flex flex-col gap-3 group/card animate-slide-up"
                style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-surface-alt border border-edge-mid flex items-center justify-center shrink-0">
                    <Box size={15} className="text-ink-faint" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-ink font-mono truncate" style={{ letterSpacing: "-0.01em" }}>
                      {type.entityType}
                    </p>
                    <p className="text-xs text-ink-sub mt-0.5">
                      <span className="text-lg font-bold text-ink tabular-nums" style={{ letterSpacing: "-0.03em" }}>{type.count.toLocaleString()}</span>
                      {" "}{t("entityUnit")}
                    </p>
                  </div>
                  <ChevronRight
                    size={14}
                    className="text-ink-faint shrink-0 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 transition-opacity -translate-x-1 group-hover/card:translate-x-0 group-focus-within/card:translate-x-0 duration-150"
                  />
                </div>
                {/* 占总量占比条（补次级信息 + 提密度，#107） */}
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-edge overflow-hidden">
                    {barPct > 0 && (
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${barPct}%`, background: `color-mix(in srgb, ${accent} 78%, transparent)` }}
                      />
                    )}
                  </div>
                  <p className="text-2xs text-ink-faint tabular-nums">
                    {t("shareOfTotal", { pct: share >= 0.1 ? share.toFixed(1) : "<0.1" })}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : mounted ? (
        // 全视口画布：portal 到 body 逃出 sheet（sheet 的 backdrop-filter 会困住 fixed），
        // 铺满整个视口，控件作悬浮 HUD；z 低于 nav-spine(11)/chrome(10) → 它们仍浮于其上可用
        createPortal(
          <div className="fixed inset-0 z-[5] animate-fade-in" style={{ background: "var(--myc-soil)" }}>
            {graphType && <EntityGraph key={graphType} entityType={graphType} />}

            <div
              className="fixed top-4 left-1/2 -translate-x-1/2 z-[6] flex items-center gap-2.5 px-3 py-1.5 rounded-full"
              style={{ background: "var(--myc-glass)", border: "1px solid var(--myc-thread)", backdropFilter: "blur(10px)" }}
            >
              <Share2 size={13} style={{ color: "var(--myc-bio)" }} />
              <select
                value={graphType}
                onChange={e => setGraphType(e.target.value)}
                className="bg-transparent text-sm outline-none cursor-pointer"
                style={{ color: "var(--myc-cream)" }}
              >
                {types.map(ty => (
                  <option key={ty.entityType} value={ty.entityType} style={{ color: "#1c1610" }}>{ty.entityType} ({ty.count})</option>
                ))}
              </select>
              <span className="w-px h-4" style={{ background: "var(--myc-thread)" }} />
              <button
                onClick={() => setView("list")}
                className="flex items-center gap-1 text-xs hover:opacity-80"
                style={{ color: "var(--myc-dim)" }}
              >
                <List size={12} /> {t("viewList")}
              </button>
            </div>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}

function ViewTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ size?: number }>; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${active ? "bg-ink text-surface" : "text-ink-sub hover:text-ink"}`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="card-border overflow-hidden p-5 flex items-center gap-4 animate-pulse">
          <div className="w-9 h-9 bg-edge-mid rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-24 bg-edge-mid rounded" />
            <div className="h-3 w-16 bg-edge rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyEntities({ onRegister }: { onRegister: () => void }) {
  const t = useTranslations("entities");
  return (
    <div className="card-border overflow-hidden animate-fade-in">
      <div className="py-28 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-surface-alt to-surface border border-edge-mid flex items-center justify-center mb-5 shadow-md">
          <Box size={22} className="text-ink-faint" strokeWidth={1.5} />
        </div>
        <p className="text-md font-semibold text-ink-sub">{t("noEntities")}</p>
        <p className="text-sm text-ink-faint mt-1.5 max-w-[220px] leading-relaxed">
          {t("noEntitiesDesc")}
        </p>
        <button
          onClick={onRegister}
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-ink-dim hover:text-ink border border-edge-mid hover:border-edge-strong px-3 py-1.5 rounded-lg transition-all"
        >
          <Plus size={12} />
          {t("registerEntity")}
        </button>
      </div>
    </div>
  );
}
