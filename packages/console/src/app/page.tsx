/**
 * Dashboard 主页
 *
 * 薄编排层：负责双模式（展示 / 编辑）切换、布局 CRUD、widget 容器渲染。
 * 业务逻辑下沉至：
 *   - components/dashboard/use-dashboard-data  数据 hook
 *   - components/dashboard/widgets             所有 widget 组件
 *   - components/dashboard/layout-config       网格配置与尺寸预设
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactGridLayout, { type LayoutItem } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import { useTranslations } from "next-intl";
import {
  RefreshCw, Pencil, Check, GripHorizontal, RotateCcw, Maximize2, X,
} from "lucide-react";
import {
  getDashboardLayout, saveDashboardLayout,
  type PersistedDashboardLayout,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import { renderWidget, fmt } from "@/components/dashboard/widgets";
import { TagOrganism } from "@/components/dashboard/tag-organism";
import {
  ROW_H, MARGIN, PAD,
  LAYOUT_VERSION,
  SIZE_PRESETS, WIDGET_PRESETS,
  currentPreset,
  getBreakpoint, getCols, getCanvasWidth, getDefaultLayout,
  type SizeKey, type BreakpointKey,
} from "@/components/dashboard/layout-config";

type PersistedLayout = PersistedDashboardLayout & { items: LayoutItem[] };

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const [layout,      setLayout]      = useState<LayoutItem[]>([]);
  const [editMode,      setEditMode]      = useState(false);
  const [layoutReady,   setLayoutReady]   = useState(false);
  const [confirmReset,  setConfirmReset]  = useState(false);
  const [breakpoint,  setBreakpoint]  = useState<BreakpointKey>("xl");
  const [orgFull,     setOrgFull]     = useState(false);
  const [mounted,     setMounted]     = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!orgFull) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOrgFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orgFull]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── 响应式断点检测 ────────────────────────────────────────────────
  useEffect(() => {
    const updateBreakpoint = () => {
      const bp = getBreakpoint(window.innerWidth);
      setBreakpoint(prev => prev !== bp ? bp : prev);
    };
    updateBreakpoint();
    window.addEventListener("resize", updateBreakpoint);
    return () => window.removeEventListener("resize", updateBreakpoint);
  }, []);

  // 数据：编辑态暂停自动刷新（避免数据跳变干扰拖拽）
  const { data, loading, refreshing, updatedAt, refresh } = useDashboardData({
    autoRefreshMs: 10_000,
    paused: editMode,
  });

  // ── 加载持久化布局 ────────────────────────────────────────────────
  useEffect(() => {
    getDashboardLayout()
      .then(raw => {
        const saved = raw as PersistedLayout | LayoutItem[] | null;
        if (saved && !Array.isArray(saved) && saved.version === LAYOUT_VERSION
            && Array.isArray(saved.items) && saved.items.length > 0) {
          setLayout(saved.items as LayoutItem[]);
        } else {
          // 无有效保存布局时使用当前断点的默认布局
          setLayout(getDefaultLayout(breakpoint));
        }
      })
      .catch(() => {
        setLayout(getDefaultLayout(breakpoint));
      })
      .finally(() => setLayoutReady(true));
  }, [breakpoint]);

  // ── 持久化（防抖）─────────────────────────────────────────────────
  const persist = useCallback((items: LayoutItem[]) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload: PersistedLayout = { version: LAYOUT_VERSION, items };
      saveDashboardLayout(payload).catch(console.error);
    }, 500);
  }, []);

  const handleLayoutChange = useCallback((next: readonly LayoutItem[]) => {
    const items = [...next] as LayoutItem[];
    setLayout(items);
    persist(items);
  }, [persist]);

  const switchSize = useCallback((id: string, size: SizeKey) => {
    setLayout(prev => {
      const next = prev.map(it =>
        it.i === id ? { ...it, w: SIZE_PRESETS[size].w, h: SIZE_PRESETS[size].h } : it,
      );
      persist(next);
      return next;
    });
  }, [persist]);

  const resetLayout = useCallback(() => {
    setConfirmReset(true);
  }, []);

  const doResetLayout = useCallback(() => {
    setConfirmReset(false);
    const defaultLayout = getDefaultLayout(breakpoint);
    setLayout(defaultLayout);
    persist(defaultLayout);
  }, [persist, breakpoint]);

  // ── 倒计时刷新指示（仅展示模式）────────────────────────────────
  const [countdown, setCountdown] = useState(10);
  useEffect(() => {
    if (editMode) return;
    setCountdown(10);
    const id = setInterval(() => setCountdown(c => c <= 1 ? 10 : c - 1), 1000);
    return () => clearInterval(id);
  }, [editMode, updatedAt]);

  // ── 加载中骨架 ────────────────────────────────────────────────────
  if (loading || !layoutReady || !data) {
    return (
      <div className="flex items-center justify-center bg-surface" style={{ minHeight: "70vh" }}>
        <div className="text-center space-y-3">
          <div className="relative mx-auto w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-edge" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-ink-sub animate-spin" />
          </div>
          <p className="text-xs tracking-wider text-ink-faint">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-surface">

      <PageHeader
        sticky
        meta={
          <>
            {!editMode && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-1/10 border border-brand-1/25">
                <span className="relative w-1.5 h-1.5">
                  <span className="absolute inset-0 rounded-full animate-ping bg-brand-1" />
                  <span className="absolute inset-0 rounded-full bg-brand-1" />
                </span>
                <span className="text-2xs tabular-nums text-ink-dim">
                  {t("autoRefresh", { n: countdown })}
                </span>
              </div>
            )}
            {updatedAt && (
              <span className="text-xs tabular-nums font-mono text-ink-faint">
                {updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </>
        }
        action={
          // mr-24 为右上角全局固定工具栏（主题切换 / 帮助，app-shell 中 fixed top-4 right-5）
          // 预留空间，避免 dashboard 全宽 sticky 头部的操作按钮与之重叠。
          <div className="flex items-center gap-2 mr-24">
            <ToolBtn onClick={refresh} disabled={refreshing}
              icon={<RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />} label={refreshing ? t("refreshing") : tCommon("refresh")} />
            {editMode && (
              <ToolBtn onClick={resetLayout} icon={<RotateCcw size={12} />} label={t("resetLayout")} />
            )}
            <ToolBtn onClick={() => setEditMode(v => !v)}
              icon={editMode ? <Check size={12} /> : <Pencil size={12} />}
              label={editMode ? t("doneEditing") : t("customize")}
              active={editMode} />
          </div>
        }
      />

      <ConfirmDialog
        open={confirmReset}
        title={t("resetLayout")}
        description={t("resetConfirm")}
        onConfirm={doResetLayout}
        onCancel={() => setConfirmReset(false)}
      />

      {/* ───── 标签有机体 hero（#109 设计签名母题，design-notes §4）───── */}
      {!editMode && (
        <section
          className="relative mx-4 mt-1 mb-3 rounded-2xl overflow-hidden"
          style={{ height: "66vh", minHeight: 420, border: "1px solid var(--myc-thread)", background: "var(--myc-soil)" }}
        >
          <TagOrganism />
          <div className="absolute top-4 left-5 z-10 pointer-events-none">
            <p className="text-xs tracking-widest uppercase" style={{ color: "var(--myc-dim)", fontFamily: "var(--font-myc-mono)" }}>
              {t("organismTitle")}
            </p>
            <p className="text-2xs mt-1" style={{ color: "var(--myc-dim)" }}>{t("organismHint")}</p>
          </div>
          <button
            onClick={() => setOrgFull(true)}
            title="全屏画布"
            className="absolute top-4 right-4 z-10 p-1.5 rounded-md"
            style={{ background: "var(--myc-glass)", border: "1px solid var(--myc-thread)", color: "var(--myc-cream)", backdropFilter: "blur(8px)" }}
          >
            <Maximize2 size={14} />
          </button>
        </section>
      )}

      {/* ───── 全屏有机体（portal 逃出 sheet · 画布优先 · KPI 悬浮 HUD）───── */}
      {orgFull && mounted && createPortal(
        <div className="fixed inset-0 z-[5] animate-fade-in" style={{ background: "var(--myc-soil)" }}>
          <TagOrganism />
          <div className="fixed z-[6]" style={{ top: "5.5rem", left: "5rem" }}>
            <HudStat label={t("statsGroupsTitle")} value={fmt(data?.stats?.groups ?? 0)} />
          </div>
          <div className="fixed z-[6]" style={{ top: "5.5rem", right: "1.8rem", textAlign: "right" }}>
            <HudStat label={t("statsTagsTitle")} value={fmt(data?.stats?.tags ?? 0)} glow />
          </div>
          <div className="fixed z-[6]" style={{ bottom: "5.5rem", left: "5rem" }}>
            <HudStat label={t("statsEntitiesTitle")} value={fmt(data?.stats?.entities ?? 0)} />
          </div>
          <div className="fixed z-[6]" style={{ bottom: "5.5rem", right: "1.8rem", textAlign: "right" }}>
            <HudStat label={t("statsAuditsTitle")} value={fmt(data?.stats?.pending ?? 0)} amber />
          </div>
          <button
            onClick={() => setOrgFull(false)}
            title="退出全屏 (Esc)"
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[7] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
            style={{ background: "var(--myc-glass)", border: "1px solid var(--myc-thread)", color: "var(--myc-dim)", backdropFilter: "blur(10px)" }}
          >
            <X size={12} /> 退出全屏
          </button>
        </div>,
        document.body,
      )}

      {/* ───── 画布 ───────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex-1 overflow-x-auto overflow-y-hidden relative bg-surface",
          editMode && "bento-edit bento-grid-dots",
        )}
      >
        <ReactGridLayout
          layout={layout}
          cols={getCols(breakpoint)}
          rowHeight={ROW_H}
          width={getCanvasWidth(breakpoint)}
          margin={MARGIN}
          containerPadding={PAD}
          isDraggable={editMode}
          isResizable={false}
          onLayoutChange={handleLayoutChange}
          compactType={null}
          draggableHandle=".drag-handle"
          useCSSTransforms
        >
          {layout.map(item => (
            <div
              key={item.i}
              className={cn(
                "flex flex-col overflow-hidden group/card transition-all duration-300 rounded-[20px] bg-card border",
                editMode
                  ? "cursor-move border-edge-mid shadow-2xl shadow-black/40"
                  : "border-edge shadow-lg shadow-black/30",
              )}
            >
              {editMode && <EditHeader id={item.i} item={item} onSwitchSize={switchSize} />}
              <div className="flex-1 min-h-0">{renderWidget(item.i, data)}</div>
            </div>
          ))}
        </ReactGridLayout>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 工具栏按钮
// ═══════════════════════════════════════════════════════════════
function ToolBtn({ icon, label, onClick, disabled, active }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-30 border",
        active
          ? "text-ink bg-overlay border-edge-mid"
          : "text-ink-dim border-edge hover:bg-surface-alt",
      )}
      style={active ? undefined : { background: "var(--tint-subtle)" }}
    >
      {icon}{label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// 编辑模式：拖拽把手 + 尺寸切换
// ═══════════════════════════════════════════════════════════════
function EditHeader({ id, item, onSwitchSize }: {
  id: string; item: LayoutItem; onSwitchSize: (id: string, size: SizeKey) => void;
}) {
  const t = useTranslations("dashboard");
  const WIDGET_LABEL_MAP: Record<string, string> = {
    "kpi-hero":      t("widgetLabels.kpiHero"),
    "entity-pie":    t("widgetLabels.entityPie"),
    "trend-chart":   t("widgetLabels.trendChart"),
    "stat-groups":   t("widgetLabels.statGroups"),
    "stat-tags":     t("widgetLabels.statTags"),
    "stat-entities": t("widgetLabels.statEntities"),
    "stat-pending":  t("widgetLabels.statPending"),
    "activity-feed": t("widgetLabels.activityFeed"),
    "health-bar":    t("widgetLabels.healthBar"),
  };
  const presets = WIDGET_PRESETS[id] ?? [];
  return (
    <div
      className="drag-handle flex items-center justify-between gap-2 px-3 py-2 shrink-0 select-none cursor-grab active:cursor-grabbing border-b border-edge"
      style={{ background: "var(--tint-subtle)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <GripHorizontal size={12} className="text-ink-faint" />
        <span className="text-2xs uppercase tracking-[0.1em] truncate text-ink-sub">
          {WIDGET_LABEL_MAP[id] ?? id}
        </span>
      </div>
      {presets.length > 1 && (
        <div className="flex gap-0.5 shrink-0 cursor-default"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          {presets.map(size => {
            const active = currentPreset(item) === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => onSwitchSize(id, size)}
                title={SIZE_PRESETS[size].tip}
                className={cn(
                  "text-2xs font-semibold px-1.5 py-0.5 rounded-md transition-all border",
                  active
                    ? "text-ink bg-overlay border-edge-mid"
                    : "text-ink-sub bg-transparent border-edge",
                )}
              >
                {SIZE_PRESETS[size].label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 全屏有机体的四角 KPI 悬浮读数（HUD）
function HudStat({ label, value, glow, amber }: { label: string; value: string; glow?: boolean; amber?: boolean }) {
  return (
    <div className="pointer-events-none">
      <div style={{ fontFamily: "var(--font-myc-mono)", fontSize: ".58rem", letterSpacing: ".18em", textTransform: "uppercase", color: "var(--myc-dim)" }}>
        {label}
      </div>
      <div style={{
        fontSize: "clamp(1.6rem,3vw,2.8rem)", fontWeight: 800, lineHeight: 1, marginTop: ".25rem", letterSpacing: "-.02em",
        color: amber ? "var(--myc-amber)" : "var(--myc-cream)",
        textShadow: glow ? "0 0 30px rgba(111,245,200,.5)" : "none",
      }}>
        {value}
      </div>
    </div>
  );
}
