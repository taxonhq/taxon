/**
 * DashboardCanvas — 单一画布 · 模板化漂浮 widget（菌丝 v2 · #125 / refinement §6 supersede）
 *
 * 模型（v5 固定舞台）：
 *  - 有机体「大地」作全屏背景，可 pan/zoom 探索（相机只动背景）
 *  - widget 摆在一块固定虚拟舞台（STAGE 1440×900）里，用绝对坐标 (x,y) + 模板尺寸
 *  - 渲染时把整块舞台**等比缩放居中**塞进视口（letterbox）→ 布局处处一样、永不重叠/溢出
 *  - 编辑态：拖放 widget（10px 细网格 + 实体碰撞）、切模板尺寸、增删 widget
 *
 * 持久化复用 getDashboardLayout / saveDashboardLayout（后端存 { version, items, cam } blob）。
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  GRID, STAGE, WIDGET_DEFS, ALL_WIDGET_IDS, CANVAS_VERSION,
  DEFAULT_CANVAS, DEFAULT_CAMERA, templateSize, parseTemplate, isTemplateAllowed,
  itemRect, stageFit, rectsOverlap,
  type CanvasItem, type CanvasCamera, type TemplateKey, type WidgetId, type OrganismMeta,
} from "./canvas-config";

interface Props {
  data: DashboardData;
  refreshing: boolean;
  /** 数据刷新令牌（updatedAt 时间戳）；驱动背景有机体原地平滑更新 */
  reloadToken: number;
  /** 上次成功刷新时间（用于刷新按钮 hover 提示） */
  updatedAt?: Date | null;
  onRefresh: () => void;
  /** 编辑态暂停自动刷新（由父层根据此回调控制） */
  onEditingChange?: (editing: boolean) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// 展示态拖动阈值（px）：位移小于此视为点击（下钻），否则视为平移取景
const DRAG_THRESH = 4;

export function DashboardCanvas({ data, refreshing, reloadToken, updatedAt, onRefresh, onEditingChange }: Props) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");

  // 顶部右侧动作带的 portal 落点（由 AppShell 在 #myc-dash-actions 提供）
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setActionSlot(document.getElementById("myc-dash-actions")); }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [items, setItems] = useState<CanvasItem[]>(DEFAULT_CANVAS);
  const [cam, setCam] = useState<CanvasCamera>(DEFAULT_CAMERA);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [panning, setPanning] = useState(false);
  const [orgMeta, setOrgMeta] = useState<OrganismMeta | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 舞台等比适配视口：scale + 居中偏移。拖动手柄要把屏幕位移换算回舞台坐标，故存一份 ref。
  const fit = useMemo(() => stageFit(size), [size]);
  const scaleRef = useRef(fit.scale);
  useEffect(() => { scaleRef.current = fit.scale; }, [fit.scale]);

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

  // ── widget 拖动（编辑态，10px 细网格 + 实体碰撞：撞上停住、贴边滑动） ──────
  type DragState = {
    id: string; startX: number; startY: number; ox: number; oy: number;
    lastLeft: number; lastTop: number; width: number; height: number;
    obstacles: Array<{ left: number; top: number; width: number; height: number }>;
  };
  const dragRef = useRef<DragState | null>(null);
  const onWidgetPointerDown = useCallback((e: React.PointerEvent, it: CanvasItem) => {
    if (!editing) return;
    if ((e.target as HTMLElement).closest("[data-noselect]")) return;
    e.preventDefault();
    setSel(it.i);
    const rect = itemRect(it); // 舞台坐标
    // 拖动期间其它 widget 不动，按下时快照它们的矩形作障碍物（舞台坐标）
    const obstacles = items.filter(p => p.i !== it.i).map(p => itemRect(p));
    dragRef.current = {
      id: it.i, startX: e.clientX, startY: e.clientY, ox: rect.left, oy: rect.top,
      lastLeft: rect.left, lastTop: rect.top, width: rect.width, height: rect.height, obstacles,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [editing, items]);

  const onWidgetPointerMove = useCallback((e: React.PointerEvent, it: CanvasItem) => {
    const d = dragRef.current;
    if (!d || d.id !== it.i) return;
    const { width, height, obstacles } = d;
    // 屏幕位移 ÷ 缩放 = 舞台位移 → 起点舞台坐标 + 之 → 10px 细网格对齐 → 夹进舞台边界
    const s = scaleRef.current || 1;
    let nx = d.ox + (e.clientX - d.startX) / s;
    let ny = d.oy + (e.clientY - d.startY) / s;
    nx = Math.round(nx / GRID) * GRID;
    ny = Math.round(ny / GRID) * GRID;
    nx = clamp(nx, 0, Math.max(0, STAGE.w - width));
    ny = clamp(ny, 0, Math.max(0, STAGE.h - height));
    // 轴分离碰撞：从上一处合法位分别尝试 X / Y，撞上的方向保持不动（贴边滑动）
    const hits = (l: number, t: number) => obstacles.some(o => rectsOverlap({ left: l, top: t, width, height }, o));
    let accLeft = d.lastLeft, accTop = d.lastTop;
    if (!hits(nx, accTop)) accLeft = nx;
    if (!hits(accLeft, ny)) accTop = ny;
    d.lastLeft = accLeft; d.lastTop = accTop;
    setItems(prev => prev.map(p => p.i === it.i ? { ...p, x: accLeft, y: accTop } : p));
  }, []);

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
    const onWheel = (e: WheelEvent) => {
      // 展示态：滚轮落在 widget 内（如活动流）时正常滚动，不劫持为缩放
      if (!editing && (e.target as HTMLElement)?.closest?.(".myc-widget")) return;
      e.preventDefault();
      setCam(c => {
        const s = clamp(c.s - Math.sign(e.deltaY) * 0.08, 0.5, 2);
        return { ...c, s: Number(s.toFixed(2)) };
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [editing]);

  // ── 展示态：拖背景平移（4px 阈值区分点击下钻 vs 拖动）。相机非默认时给复位入口。──
  const dispPanRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const onDisplayPanStart = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    // 每次新交互先清掉上次拖动可能遗留的抑制标志（拖动后浏览器常不发 click）
    suppressClickRef.current = false;
    dispPanRef.current = { sx: e.clientX, sy: e.clientY, ox: camRef.current.x, oy: camRef.current.y, moved: false };
  }, [editing]);
  // 拖动后抑制紧随的 click，避免误触发节点 <Link> 跳转
  const onDisplayClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);
  useEffect(() => {
    if (editing) return;
    const move = (e: PointerEvent) => {
      const p = dispPanRef.current;
      if (!p) return;
      const dx = e.clientX - p.sx, dy = e.clientY - p.sy;
      if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESH) return;
      p.moved = true;
      setPanning(true);
      setCam(c => ({ ...c, x: p.ox + dx, y: p.oy + dy }));
    };
    const up = () => {
      const p = dispPanRef.current;
      if (!p) return;
      if (p.moved) { suppressClickRef.current = true; setPanning(false); }
      dispPanRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [editing]);

  // 编辑态相机存进布局；展示态取景是临时探索，不持久化
  const zoom = (delta: number) => {
    const c = camRef.current;
    const next = { ...c, s: clamp(Number((c.s + delta).toFixed(2)), 0.5, 2) };
    if (editing) commitCam(next); else setCam(next);
  };
  const resetCam = () => { if (editing) commitCam(DEFAULT_CAMERA); else setCam(DEFAULT_CAMERA); };

  // ── 模板切换 / 增删 widget ──────────────────────────────────────
  const switchTpl = (id: string, tpl: TemplateKey) => {
    if (!isTemplateAllowed(id, tpl)) return;
    const cur = items.find(it => it.i === id);
    if (!cur) return;
    // 用新模板在当前位置算矩形；若越界或与他人重叠则拒绝切换（实体平面，不许压住别人）
    const next = { ...cur, tpl };
    const rect = itemRect(next);
    const { width, height } = templateSize(tpl);
    const fits = cur.x >= 0 && cur.y >= 0 && cur.x + width <= STAGE.w && cur.y + height <= STAGE.h;
    const clash = items.some(p => p.i !== id && rectsOverlap(rect, itemRect(p)));
    if (!fits || clash) return;
    commitItems(items.map(it => it.i === id ? next : it));
  };
  const removeWidget = (id: string) => {
    commitItems(items.filter(it => it.i !== id));
    setSel(null);
  };
  // 在舞台内找一个不与现有 widget 重叠的空位（按 GRID 步进扫描，找不到就回落舞台中心）
  const findFreeSpot = (tpl: TemplateKey): { x: number; y: number } => {
    const { width, height } = templateSize(tpl);
    const others = items.map(p => itemRect(p));
    const step = GRID * 2;
    for (let y = 60; y + height <= STAGE.h; y += step) {
      for (let x = 60; x + width <= STAGE.w; x += step) {
        const r = { left: x, top: y, width, height };
        if (!others.some(o => rectsOverlap(r, o))) return { x, y };
      }
    }
    return { x: Math.round((STAGE.w - width) / 2 / GRID) * GRID, y: Math.round((STAGE.h - height) / 2 / GRID) * GRID };
  };
  const addWidget = (id: WidgetId) => {
    if (items.some(it => it.i === id)) return;
    const def = WIDGET_DEFS[id];
    const spot = findFreeSpot(def.defaultTpl);
    commitItems([...items, { i: id, tpl: def.defaultTpl, x: spot.x, y: spot.y }]);
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
  const camMoved = cam.x !== 0 || cam.y !== 0 || cam.s !== 1;

  return (
    <div
      ref={rootRef}
      className={cn("absolute inset-0 overflow-hidden", editing && "myc-editing")}
    >
      {/* 地图层：只有背景（有机体「菌丝 / 大地」）随相机缩放 / 平移 */}
      <div
        className="absolute inset-0 z-[2]"
        style={{ transform: boardTransform, transformOrigin: "50% 50%", transition: panning ? "none" : "transform .12s ease-out", cursor: editing ? undefined : "grab" }}
        onPointerDown={editing ? undefined : onDisplayPanStart}
        onClickCapture={editing ? undefined : onDisplayClickCapture}
      >
        {/* 有机体大地（背景；展示态可 hover 探索 / 点击下钻；随刷新原地更新） */}
        <div className="absolute inset-0 z-0">
          <TagOrganism reloadToken={reloadToken} onMeta={setOrgMeta} />
        </div>

        {/* 空白处拖动 = 平移地图（仅编辑态覆盖，避免挡住展示态的 hover） */}
        {editing && (
          <div
            className="absolute inset-0 z-[1]"
            style={{ cursor: "grab" }}
            onPointerDown={onBgPointerDown}
          />
        )}
      </div>

      {/* 编辑态遮罩：压暗发光背景（浮在有机体之上、widget 之下，不挡背景平移）。 */}
      {editing && (
        <div
          className="absolute inset-0 z-[2] pointer-events-none"
          style={{ backgroundColor: "color-mix(in srgb, var(--myc-soil) 60%, transparent)" }}
        />
      )}

      {/* 前景 widget 舞台：固定 STAGE 尺寸，整体等比缩放居中（letterbox）。
          容器 pointer-events:none 让空白处穿透到下方地图层去平移；widget 自身恢复 auto。 */}
      <div
        className="absolute z-[3]"
        style={{
          left: 0, top: 0, width: STAGE.w, height: STAGE.h,
          transform: `translate(${fit.offX}px, ${fit.offY}px) scale(${fit.scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        {/* 编辑态对齐网格：铺满舞台、随舞台缩放（每 5 格画一个淡点，纯方位参考） */}
        {editing && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(rgba(241,233,218,.16) 1px, transparent 1px)",
              backgroundSize: `${GRID * 5}px ${GRID * 5}px`,
            }}
          />
        )}
        {ready && items.map((it) => {
          const isSel = sel === it.i;
          // 舞台坐标矩形（内含夹取，保证 widget 不越出舞台）
          const { left, top, width, height } = itemRect(it);
          return (
            <div
              key={it.i}
              className={cn(
                "myc-widget absolute",
                editing && "is-editing",
                isSel && "is-sel",
              )}
              style={{ left, top, width, height, pointerEvents: "auto" }}
              onPointerDown={(e) => onWidgetPointerDown(e, it)}
              onPointerMove={(e) => onWidgetPointerMove(e, it)}
              onPointerUp={(e) => onWidgetPointerUp(e, it)}
            >
              {/* 内层裁剪内容到圆角；外层 overflow 可见，让尺寸切换器能浮出。
                  编辑态屏蔽内部交互（Link/图表 tooltip 失效），只剩外框拖动，避免误跳转。 */}
              <div className="myc-widget-body" style={{ pointerEvents: editing ? "none" : "auto" }}>
                {renderCanvasWidget(it.i, it.tpl, data, orgMeta)}
              </div>

              {editing && (
                <span className="myc-widget-tpl">{it.tpl}</span>
              )}

              {/* 选中：尺寸切换器 + 删除（贴顶时翻到下方，避免冒出视口） */}
              {editing && isSel && (
                <div className={cn("myc-sizesw", top < 36 && "below")} data-noselect>
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

      {/* ── 刷新 / 自定义 → portal 进右上动作带，与「主题/设置」并排 ── */}
      {actionSlot && createPortal(
        <>
          <button
            className="myc-dashbtn"
            onClick={onRefresh}
            disabled={refreshing}
            title={updatedAt ? t("updatedAt", { time: updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : tCommon("refresh")}
            aria-label={tCommon("refresh")}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button className={cn("myc-dashbtn", editing && "on")} onClick={toggleEdit}>
            {editing ? <Check size={13} /> : <Pencil size={13} />}
            {editing ? t("doneEditing") : t("customize")}
          </button>
          <span className="myc-status-sep" aria-hidden />
        </>,
        actionSlot,
      )}

      {/* ── 编辑工具条（顶部居中，仅编辑态）：增删 widget / 重置布局 ── */}
      {editing && (
        <div className="myc-dashbar">
          <button className="myc-dashbtn" onClick={() => setShowCatalog(v => !v)} title={t("addWidget")}>
            <Plus size={13} />{t("addWidget")}
          </button>
          <button className="myc-dashbtn" onClick={resetLayout} title={t("resetLayout")}>
            <RotateCcw size={13} />{t("resetLayout")}
          </button>
        </div>
      )}

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

      {/* ── 取景控制：编辑态常显；展示态仅在已平移/缩放时出现（提供复位） ── */}
      {(editing || camMoved) && (
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
