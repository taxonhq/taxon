"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Box, ChevronRight, X } from "lucide-react";
import { getEntityTypes, registerEntity, getEntitiesByType } from "@/lib/api";
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
    } catch {
      setError("加载失败，请检查服务是否正常运行");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.entityType.trim() || !form.entityId.trim()) {
      setError("实体类型和 ID 均为必填");
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
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setSaving(false);
    }
  };

  const knownTypes = types.map(t => t.entityType);

  return (
    <div className="space-y-7">
      <PageHeader
        title="实体管理"
        description="管理已注册的业务实体及其标签关联"
        action={
          <Button size="sm" onClick={() => setShowForm(v => !v)}>
            <Plus size={13} />
            注册实体
          </Button>
        }
      />

      <ErrorBanner message={error} />

      {/* Register form */}
      {showForm && (
        <div className="card-border overflow-hidden p-5 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-semibold text-ink">注册新实体</p>
              <p className="text-[12px] text-ink-sub mt-0.5">注册后可为实体打标，实体 ID 来自业务系统</p>
            </div>
            <button onClick={() => setShowForm(false)} className="p-1.5 text-ink-faint hover:text-ink transition-colors rounded-lg hover:bg-surface-alt">
              <X size={14} />
            </button>
          </div>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="实体类型" required hint="如 dish、dining、product">
                <Combobox
                  value={form.entityType}
                  onChange={v => setForm(f => ({ ...f, entityType: v }))}
                  options={knownTypes}
                  placeholder="输入或选择类型…"
                />
              </Field>
              <Field label="实体 ID" required hint="业务系统中的唯一标识符">
                <Input
                  value={form.entityId}
                  onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                  placeholder="如 restaurant-123、uuid-..."
                  className="font-mono"
                />
              </Field>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
              <Button type="submit" size="sm" loading={saving}>注册</Button>
            </div>
          </form>
        </div>
      )}

      {/* Entity type cards */}
      {loading ? (
        <SkeletonGrid />
      ) : types.length === 0 ? (
        <EmptyEntities onRegister={() => setShowForm(true)} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {types.map((t, i) => (
            <Link
              key={t.entityType}
              href={`/entities/${encodeURIComponent(t.entityType)}`}
              className="card-border overflow-hidden p-5 flex items-center gap-4 group/card animate-slide-up"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {/* Icon */}
              <div className="w-9 h-9 rounded-xl bg-surface-alt border border-edge-mid flex items-center justify-center shrink-0">
                <Box size={15} className="text-ink-faint" strokeWidth={1.5} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-ink font-mono truncate" style={{ letterSpacing: "-0.01em" }}>
                  {t.entityType}
                </p>
                <p className="text-[11px] text-ink-sub mt-1">
                  <span className="text-[15px] font-bold text-ink tabular-nums" style={{ letterSpacing: "-0.03em" }}>{t.count}</span>
                  {" "}个实体
                </p>
              </div>

              {/* Arrow */}
              <ChevronRight
                size={14}
                className="text-ink-faint shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity -translate-x-1 group-hover/card:translate-x-0 duration-150"
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
  return (
    <div className="card-border overflow-hidden animate-fade-in">
      <div className="py-28 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#161616] to-[#0A0A0A] border border-edge-mid flex items-center justify-center mb-5 shadow-[0_2px_8px_rgba(0,0,0,.4)]">
          <Box size={22} className="text-ink-faint" strokeWidth={1.5} />
        </div>
        <p className="text-[14px] font-semibold text-ink-sub">暂无已注册实体</p>
        <p className="text-[12px] text-ink-faint mt-1.5 max-w-[220px] leading-relaxed">
          注册第一个实体后，实体类型将自动出现在这里
        </p>
        <button
          onClick={onRegister}
          className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-ink-dim hover:text-ink border border-edge-mid hover:border-edge-strong px-3 py-1.5 rounded-lg transition-all"
        >
          <Plus size={12} />
          注册实体
        </button>
      </div>
    </div>
  );
}
