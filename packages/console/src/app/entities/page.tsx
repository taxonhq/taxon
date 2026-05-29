"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Box, ChevronRight, X } from "lucide-react";
import { getEntityTypes, registerEntity } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";

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

  return (
    <div className="space-y-7">
      <PageHeader
        title={t("title")}
        description={t("description")}
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

      {/* Summary strip */}
      {!loading && types.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-edge bg-surface-alt/40 text-xs text-ink-sub animate-fade-in">
          <span className="font-semibold text-ink">{types.length}</span>
          {t("entityTypeCount", { count: types.length })}
          <span className="text-edge-strong">·</span>
          <span className="font-semibold text-ink">
            {types.reduce((s, t) => s + t.count, 0).toLocaleString()}
          </span>
          {t("totalEntitiesCount")}
        </div>
      )}

      {/* Entity type cards */}
      {loading ? (
        <SkeletonGrid />
      ) : types.length === 0 ? (
        <EmptyEntities onRegister={() => setShowForm(true)} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {types.map((type, i) => (
            <Link
              key={type.entityType}
              href={`/entities/${encodeURIComponent(type.entityType)}`}
              className="card-border overflow-hidden p-5 flex items-center gap-4 group/card animate-slide-up"
              style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}
            >
              <div className="w-9 h-9 rounded-xl bg-surface-alt border border-edge-mid flex items-center justify-center shrink-0">
                <Box size={15} className="text-ink-faint" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-ink font-mono truncate" style={{ letterSpacing: "-0.01em" }}>
                  {type.entityType}
                </p>
                <p className="text-xs text-ink-sub mt-1">
                  <span className="text-lg font-bold text-ink tabular-nums" style={{ letterSpacing: "-0.03em" }}>{type.count}</span>
                  {" "}{t("entityUnit")}
                </p>
              </div>
              <ChevronRight
                size={14}
                className="text-ink-faint shrink-0 opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 transition-opacity -translate-x-1 group-hover/card:translate-x-0 group-focus-within/card:translate-x-0 duration-150"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
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
