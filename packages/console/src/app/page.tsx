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
import ReactGridLayout, { type LayoutItem } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import {
  RefreshCw, Pencil, Check, GripHorizontal, RotateCcw,
} from "lucide-react";
import {
  getDashboardLayout, saveDashboardLayout,
  type PersistedDashboardLayout,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import { renderWidget } from "@/components/dashboard/widgets";
import {
  ROW_H, MARGIN, PAD,
  LAYOUT_VERSION,
  SIZE_PRESETS, WIDGET_PRESETS, WIDGET_LABELS,
  currentPreset,
  getBreakpoint, getCols, getCanvasWidth, getDefaultLayout,
  type SizeKey, type BreakpointKey,
} from "@/components/dashboard/layout-config";

type PersistedLayout = PersistedDashboardLayout & { items: LayoutItem[] };

export default function DashboardPage() {
  const [layout,      setLayout]      = useState<LayoutItem[]>([]);
  const [editMode,    setEditMode]    = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [breakpoint,  setBreakpoint]  = useState<BreakpointKey>("xl");
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
    if (!confirm("确认重置布局为默认？")) return;
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
          <p className="text-xs tracking-wider text-ink-faint">加载仪表盘…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-surface">

      <PageHeader
        sticky
        title="Taxon Dashboard"
        description="标签服务运行态全局概览"
        meta={
          <>
            {!editMode && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-1/10 border border-brand-1/25">
                <span className="relative w-1.5 h-1.5">
                  <span className="absolute inset-0 rounded-full animate-ping bg-brand-1" />
                  <span className="absolute inset-0 rounded-full bg-brand-1" />
                </span>
                <span className="text-2xs tabular-nums text-ink-dim">
                  自动刷新 · {countdown}s
                </span>
              </div>
            )}
            {updatedAt && (
              <span className="text-xs tabular-nums font-mono text-ink-faint">
                {updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <ToolBtn onClick={refresh} disabled={refreshing}
              icon={<RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />} label="刷新" />
            {editMode && (
              <ToolBtn onClick={resetLayout} icon={<RotateCcw size={12} />} label="重置" />
            )}
            <ToolBtn onClick={() => setEditMode(v => !v)}
              icon={editMode ? <Check size={12} /> : <Pencil size={12} />}
              label={editMode ? "完成" : "自定义"}
              active={editMode} />
          </div>
        }
      />

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
  const presets = WIDGET_PRESETS[id] ?? [];
  return (
    <div
      className="drag-handle flex items-center justify-between gap-2 px-3 py-2 shrink-0 select-none cursor-grab active:cursor-grabbing border-b border-edge"
      style={{ background: "var(--tint-subtle)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <GripHorizontal size={12} className="text-ink-faint" />
        <span className="text-2xs uppercase tracking-[0.1em] truncate text-ink-sub">
          {WIDGET_LABELS[id] ?? id}
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
