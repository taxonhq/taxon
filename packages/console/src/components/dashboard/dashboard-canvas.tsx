/**
 * DashboardCanvas — 单一画布 · 模板化漂浮 widget（菌丝 v2 · #125 / refinement §6 supersede）
 *
 * 模型：
 *  - 一块 board（与视口同尺寸的虚拟平面），有机体作背景、widget 漂浮其上
 *  - widget 用「模板 tpl（W×H 单位）+ 分数坐标 (x,y)」表达，自由摆放、离散尺寸
 *  - 展示态：board 锁定填满视口，所有 widget 一屏可见
 *  - 编辑态：拖放 widget（落点轻吸附）、切模板尺寸、相机 pan/zoom（取景）、增删 widget
 *
 * 持久化复用 getDashboardLayout / saveDashboardLayout（后端存 { version, items, cam } blob）。
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, RotateCcw, Check, Pencil, RefreshCw, Maximize, ZoomIn, ZoomOut, X } from "lucide-react";
import {
  getDashboardLayout, saveDashboardLayout,
  type PersistedDashboardLayout,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DashboardData } from "./use-dashboard-data";
import { renderCanvasWidget } from "./widgets";
import { TagOrganism } from "./tag-organism";
import {
  UNIT, SNAP, WIDGET_DEFS, ALL_WIDGET_IDS, CANVAS_VERSION,
  DEFAULT_CANVAS, DEFAULT_CAMERA, templateSize, parseTemplate, isTemplateAllowed,
  type CanvasItem, type CanvasCamera, type TemplateKey, type WidgetId,
} from "./canvas-config";

interface Props {
  data: DashboardData;
  refreshing: boolean;
  onRefresh: () => void;
  /** 编辑态暂停自动刷新（由父层根据此回调控制） */
  onEditingChange?: (editing: boolean) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function DashboardCanvas({ data, refreshing, onRefresh, onEditingChange }: Props) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");

  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [items, setItems] = useState<CanvasItem[]>(DEFAULT_CANVAS);
  const [cam, setCam] = useState<CanvasCamera>(DEFAULT_CAMERA);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [panning, setPanning] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── 视口尺寸跟踪 ────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const el = rootRef.current;
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);

  // ── 加载持久化布局 ──────────────────────────────────────────────
  useEffect(() => {
    getDashboardLayout()
      .then(raw => {
        const saved = raw as PersistedDashboardLayout | null;
        if (saved && !Array.isArray(saved) && saved.version === CANVAS_VERSION
            && Array.isArray(saved.items) && saved.items.length > 0) {
          setItems(saved.items.filter(it => WIDGET_DEFS[it.i as WidgetId]) as CanvasItem[]);
          if (saved.cam) setCam(saved.cam);
        }
      })
      .catch(() => { /* 回落默认 */ })
      .finally(() => setReady(true));
  }, []);

  // ── 持久化（防抖） ──────────────────────────────────────────────
  const persist = useCallback((nextItems: CanvasItem[], nextCam: CanvasCamera) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload: PersistedDashboardLayout = { version: CANVAS_VERSION, items: nextItems, cam: nextCam };
      saveDashboardLayout(payload).catch(console.error);
    }, 600);
  }, []);

  const commitItems = useCallback((next: CanvasItem[]) => {
    setItems(next);
    persist(next, cam);
  }, [persist, cam]);

  const commitCam = useCallback((next: CanvasCamera) => {
    setCam(next);
    persist(items, next);
  }, [persist, items]);

  // ── widget 拖动（编辑态，落点吸附半单位网格） ──────────────────
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const onWidgetPointerDown = useCallback((e: React.PointerEvent, it: CanvasItem) => {
    if (!editing) return;
    if ((e.target as HTMLElement).closest("[data-noselect]")) return;
    e.preventDefault();
    setSel(it.i);
    dragRef.current = { id: it.i, startX: e.clientX, startY: e.clientY, ox: it.x * size.w, oy: it.y * size.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [editing, size]);

  const onWidgetPointerMove = useCallback((e: React.PointerEvent, it: CanvasItem) => {
    const d = dragRef.current;
    if (!d || d.id !== it.i) return;
    const { width, height } = templateSize(it.tpl);
    let nx = d.ox + (e.clientX - d.startX) / cam.s;
    let ny = d.oy + (e.clientY - d.startY) / cam.s;
    nx = Math.round(nx / SNAP) * SNAP;
    ny = Math.round(ny / SNAP) * SNAP;
    nx = clamp(nx, 0, Math.max(0, size.w - width));
    ny = clamp(ny, 0, Math.max(0, size.h - height));
    setItems(prev => prev.map(p => p.i === it.i ? { ...p, x: nx / size.w, y: ny / size.h } : p));
  }, [cam.s, size]);

  const onWidgetPointerUp = useCallback((e: React.PointerEvent, it: CanvasItem) => {
    if (dragRef.current?.id === it.i) {
      dragRef.current = null;
      persist(items, cam);
    }
  }, [items, cam, persist]);

  // ── 相机 pan（拖空白处）/ zoom（滚轮 + 按钮） ──────────────────
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const onBgPointerDown = useCallback((e: React.PointerEvent) => {
    if (!editing) return;
    setSel(null);
    setPanning(true);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: cam.x, oy: cam.y };
  }, [editing, cam]);
  useEffect(() => {
    if (!editing) return;
    const move = (e: PointerEvent) => {
      const p = panRef.current;
      if (!p) return;
      setCam(c => ({ ...c, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
    };
    const up = () => {
      if (panRef.current) { panRef.current = null; setPanning(false); persist(items, camRef.current); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [editing, items, persist]);

  // keep latest cam for pan-up persist without re-subscribing
  const camRef = useRef(cam);
  useEffect(() => { camRef.current = cam; }, [cam]);

  useEffect(() => {
    if (!editing) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCam(c => {
        const s = clamp(c.s - Math.sign(e.deltaY) * 0.08, 0.5, 2);
        return { ...c, s: Number(s.toFixed(2)) };
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [editing]);

  const zoom = (delta: number) => {
    const c = camRef.current;
    commitCam({ ...c, s: clamp(Number((c.s + delta).toFixed(2)), 0.5, 2) });
  };
  const resetCam = () => commitCam(DEFAULT_CAMERA);

  // ── 模板切换 / 增删 widget ──────────────────────────────────────
  const switchTpl = (id: string, tpl: TemplateKey) => {
    if (!isTemplateAllowed(id, tpl)) return;
    commitItems(items.map(it => it.i === id ? { ...it, tpl } : it));
  };
  const removeWidget = (id: string) => {
    commitItems(items.filter(it => it.i !== id));
    setSel(null);
  };
  const addWidget = (id: WidgetId) => {
    if (items.some(it => it.i === id)) return;
    const def = WIDGET_DEFS[id];
    commitItems([...items, { i: id, tpl: def.defaultTpl, x: 0.42, y: 0.42 }]);
    setSel(id);
    setShowCatalog(false);
  };
  const resetLayout = () => { commitItems(DEFAULT_CANVAS); commitCam(DEFAULT_CAMERA); };

  const toggleEdit = () => {
    setEditing(v => {
      const next = !v;
      if (!next) { setSel(null); setShowCatalog(false); }
      return next;
    });
  };

  const missing = useMemo(
    () => ALL_WIDGET_IDS.filter(id => !items.some(it => it.i === id)),
    [items],
  );

  const boardTransform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;

  return (
    <div
      ref={rootRef}
      className={cn("absolute inset-0 overflow-hidden", editing && "myc-editing")}
    >
      {/* 编辑态背景点阵（暗示单位网格） */}
      {editing && (
        <div
          className="absolute inset-0 z-[1] pointer-events-none opacity-100 transition-opacity"
          style={{
            backgroundImage: "radial-gradient(rgba(241,233,218,.10) 1px, transparent 1px)",
            backgroundSize: `${UNIT}px ${UNIT}px`,
          }}
        />
      )}

      {/* board：有机体背景 + 漂浮 widget，统一受相机变换 */}
      <div
        className="absolute inset-0 z-[2]"
        style={{ transform: boardTransform, transformOrigin: "0 0", transition: panning ? "none" : "transform .12s ease-out" }}
      >
        {/* 有机体大地（背景；展示态可 hover 探索） */}
        <div className="absolute inset-0 z-0">
          <TagOrganism />
        </div>

        {/* 空白处拖动 = 平移画布（仅编辑态覆盖，避免挡住展示态的 hover） */}
        {editing && (
          <div
            className="absolute inset-0 z-[1]"
            style={{ cursor: "grab" }}
            onPointerDown={onBgPointerDown}
          />
        )}

        {ready && items.map((it) => {
          const { width, height } = templateSize(it.tpl);
          const isSel = sel === it.i;
          return (
            <div
              key={it.i}
              className={cn(
                "myc-widget absolute",
                editing && "is-editing",
                isSel && "is-sel",
              )}
              style={{ left: it.x * size.w, top: it.y * size.h, width, height }}
              onPointerDown={(e) => onWidgetPointerDown(e, it)}
              onPointerMove={(e) => onWidgetPointerMove(e, it)}
              onPointerUp={(e) => onWidgetPointerUp(e, it)}
            >
              {/* 内层裁剪内容到圆角；外层 overflow 可见，让尺寸切换器能浮出 */}
              <div className="myc-widget-body">
                {renderCanvasWidget(it.i, it.tpl, data)}
              </div>

              {editing && (
                <span className="myc-widget-tpl">{it.tpl}</span>
              )}

              {/* 选中：尺寸切换器 + 删除 */}
              {editing && isSel && (
                <div className="myc-sizesw" data-noselect>
                  {WIDGET_DEFS[it.i as WidgetId]?.allowed.map((tpl) => {
                    const { w, h } = parseTemplate(tpl);
                    return (
                      <button
                        key={tpl}
                        type="button"
                        title={tpl}
                        className={cn("myc-sizesw-b", tpl === it.tpl && "on")}
                        style={{ width: Math.min(w, 4) * 6 + 4, height: Math.min(h, 4) * 6 + 4 }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => switchTpl(it.i, tpl)}
                      />
                    );
                  })}
                  <button
                    type="button"
                    title={tCommon("delete")}
                    className="myc-sizesw-del"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeWidget(it.i)}
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── 浮动工具条（顶部居中） ─────────────────────────────── */}
      <div className="myc-dashbar">
        <button className="myc-dashbtn" onClick={onRefresh} disabled={refreshing} title={tCommon("refresh")}>
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
        </button>
        {editing && (
          <>
            <button className="myc-dashbtn" onClick={() => setShowCatalog(v => !v)} title={t("addWidget")}>
              <Plus size={13} />{t("addWidget")}
            </button>
            <button className="myc-dashbtn" onClick={resetLayout} title={t("resetLayout")}>
              <RotateCcw size={13} />
            </button>
          </>
        )}
        <button className={cn("myc-dashbtn", editing && "on")} onClick={toggleEdit}>
          {editing ? <Check size={13} /> : <Pencil size={13} />}
          {editing ? t("doneEditing") : t("customize")}
        </button>
      </div>

      {/* ── 添加 widget 目录 ──────────────────────────────────── */}
      {editing && showCatalog && (
        <div className="myc-add-catalog">
          <div className="myc-add-head">{t("addWidget")}</div>
          {missing.length === 0 && <div className="myc-add-empty">{t("allWidgetsAdded")}</div>}
          {missing.map(id => (
            <button key={id} className="myc-add-item" onClick={() => addWidget(id)}>
              <Plus size={12} />
              {t(`widgetLabels.${WIDGET_DEFS[id].labelKey}`)}
              <span className="myc-add-tpl">{WIDGET_DEFS[id].defaultTpl}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── 编辑态取景控制 ─────────────────────────────────────── */}
      {editing && (
        <div className="myc-zoomctl">
          <button onClick={() => zoom(0.15)} title={t("zoomIn")}><ZoomIn size={15} /></button>
          <span className="myc-zoom-label">{Math.round(cam.s * 100)}%</span>
          <button onClick={() => zoom(-0.15)} title={t("zoomOut")}><ZoomOut size={15} /></button>
          <button onClick={resetCam} title={t("fitView")}><Maximize size={15} /></button>
        </div>
      )}
    </div>
  );
}
