"use client";

/**
 * usePanZoom — 力导向图的「无限画布」相机（#109）。
 *
 * 世界层是固定 W×H 的坐标空间，相机用 CSS transform `translate(x,y) scale(k)` 平移缩放。
 * 有机体与实体图谱共用：滚轮向光标缩放、空白拖拽平移、初始自适应居中、可重置。
 * 节点拖拽由各组件用 `cam.k` 把屏幕位移换算成世界位移自行实现。
 */

import { useRef, useState, useCallback, useEffect } from "react";

export interface Camera { x: number; y: number; k: number }

export function usePanZoom(worldW: number, worldH: number, minK = 0.25, maxK = 3.5) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, k: 0.6 });
  const fittedRef = useRef(false);

  // 把世界铺进容器并居中
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight;
    if (vw === 0 || vh === 0) return;
    const k = Math.max(minK, Math.min(maxK, Math.min(vw / worldW, vh / worldH) * 0.92));
    setCam({ k, x: (vw - worldW * k) / 2, y: (vh - worldH * k) / 2 });
  }, [worldW, worldH, minK, maxK]);

  // 把指定世界矩形（通常是节点包围盒）铺满容器并居中
  const fitBounds = useCallback((x0: number, y0: number, x1: number, y1: number, padFrac = 0.12) => {
    const el = containerRef.current;
    if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight;
    if (vw === 0 || vh === 0) return;
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const k = Math.max(minK, Math.min(maxK, Math.min(vw / w, vh / h) * (1 - padFrac)));
    setCam({ k, x: vw / 2 - ((x0 + x1) / 2) * k, y: vh / 2 - ((y0 + y1) / 2) * k });
  }, [minK, maxK]);

  // 首次测得尺寸后自适应
  useEffect(() => {
    if (fittedRef.current) return;
    const el = containerRef.current;
    if (el && el.clientWidth > 0) { fittedRef.current = true; fit(); }
  });

  // 滚轮向光标缩放（光标下的世界点保持不动）
  const onWheel = useCallback((e: React.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setCam(c => {
      const k = Math.max(minK, Math.min(maxK, c.k * Math.exp(-e.deltaY * 0.0016)));
      const ratio = k / c.k;
      return { k, x: mx - (mx - c.x) * ratio, y: my - (my - c.y) * ratio };
    });
  }, [minK, maxK]);

  // 空白拖拽平移
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const onBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setCam(c => { pan.current = { sx: e.clientX, sy: e.clientY, ox: c.x, oy: c.y }; return c; });
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pan.current) return;
    const { sx, sy, ox, oy } = pan.current;
    setCam(c => ({ ...c, x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) }));
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (pan.current) { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); pan.current = null; }
  }, []);

  const transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`;
  const panning = () => pan.current != null;

  return { containerRef, cam, transform, onWheel, onBackgroundPointerDown, onPointerMove, onPointerUp, fit, fitBounds, panning };
}
