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
import { useDashboardData } from "@/components/dashboard/use-dashboard-data";
import { COLORS, renderWidget } from "@/components/dashboard/widgets";
import {
  CANVAS_W, COLS, ROW_H, MARGIN, PAD,
  LAYOUT_VERSION, DEFAULT_LAYOUT,
  SIZE_PRESETS, WIDGET_PRESETS, WIDGET_LABELS,
  currentPreset, type SizeKey,
} from "@/components/dashboard/layout-config";

type PersistedLayout = PersistedDashboardLayout & { items: LayoutItem[] };

export default function DashboardPage() {
  const [layout,      setLayout]      = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const [editMode,    setEditMode]    = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
        }
      })
      .catch(() => { /* 静默 */ })
      .finally(() => setLayoutReady(true));
  }, []);

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
    setLayout(DEFAULT_LAYOUT);
    persist(DEFAULT_LAYOUT);
  }, [persist]);

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
      <div className="flex items-center justify-center" style={{ minHeight: "70vh", background: COLORS.bg1 }}>
        <div className="text-center space-y-3">
          <div className="relative mx-auto w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white/40 animate-spin" />
          </div>
          <p className="text-[11px] tracking-wider" style={{ color: COLORS.ink4 }}>加载仪表盘…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: COLORS.bg1 }}>

      {/* ───── 顶栏 ───────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-20 shrink-0"
        style={{
          borderBottom: `1px solid ${COLORS.edge1}`,
          background: "rgba(10,10,10,0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-5">
          <div>
            <h1 className="font-extrabold leading-none" style={{
              fontSize: 24, letterSpacing: "-0.04em", color: COLORS.ink,
            }}>
              Taxon Dashboard
            </h1>
            <p className="text-[11px] mt-1" style={{ color: COLORS.ink4 }}>
              标签服务运行态全局概览
            </p>
          </div>
          {/* 实时同步状态 */}
          {!editMode && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full"
              style={{ background: `${COLORS.brand1}10`, border: `1px solid ${COLORS.brand1}30` }}>
              <span className="relative w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full animate-ping" style={{ background: COLORS.brand1 }} />
                <span className="absolute inset-0 rounded-full" style={{ background: COLORS.brand1 }} />
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: COLORS.ink2 }}>
                自动刷新 · {countdown}s
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-[11px] tabular-nums mr-2 font-mono" style={{ color: COLORS.ink4 }}>
              {updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
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
      </header>

      {/* ───── 画布 ───────────────────────────────────────────────── */}
      <div
        className={cn("flex-1 overflow-x-auto overflow-y-hidden relative", editMode && "bento-edit")}
        style={editMode ? {
          background: COLORS.bg1,
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        } : { background: COLORS.bg1 }}
      >
        <ReactGridLayout
          layout={layout}
          cols={COLS}
          rowHeight={ROW_H}
          width={CANVAS_W}
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
              className={cn("flex flex-col overflow-hidden group/card transition-all duration-300",
                editMode && "cursor-move")}
              style={{
                borderRadius: 20,
                background: COLORS.bg2,
                border: editMode
                  ? `1px solid ${COLORS.edge2}`
                  : `1px solid ${COLORS.edge1}`,
                boxShadow: editMode
                  ? `0 0 0 1px ${COLORS.edge1} inset, 0 24px 60px rgba(0,0,0,0.7)`
                  : `0 1px 0 0 rgba(255,255,255,0.025) inset, 0 8px 32px rgba(0,0,0,0.5)`,
              }}
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
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30"
      style={active ? {
        color: COLORS.ink,
        background: COLORS.bg3,
        border: `1px solid ${COLORS.edge2}`,
      } : {
        color: COLORS.ink2,
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${COLORS.edge1}`,
      }}>
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
    <div className="drag-handle flex items-center justify-between gap-2 px-3 py-2 shrink-0 select-none cursor-grab active:cursor-grabbing"
      style={{ borderBottom: `1px solid ${COLORS.edge1}`, background: "rgba(255,255,255,0.02)" }}>
      <div className="flex items-center gap-2 min-w-0">
        <GripHorizontal size={12} style={{ color: COLORS.ink4 }} />
        <span className="text-[10px] uppercase tracking-[0.1em] truncate" style={{ color: COLORS.ink3 }}>
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
              <button key={size} type="button" onClick={() => onSwitchSize(id, size)}
                title={SIZE_PRESETS[size].tip}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md transition-all"
                style={active ? {
                  color: COLORS.ink, background: COLORS.bg3, border: `1px solid ${COLORS.edge2}`,
                } : {
                  color: COLORS.ink3, background: "transparent", border: `1px solid ${COLORS.edge1}`,
                }}>
                {SIZE_PRESETS[size].label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
