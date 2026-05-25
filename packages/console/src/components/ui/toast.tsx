"use client";

/**
 * Lightweight Toast 系统
 *
 * 用法：
 *   import { toast } from "@/components/ui/toast";
 *   toast.success("操作成功");
 *   toast.error("操作失败");
 *   toast.info("提示信息");
 *
 * 在 layout.tsx 中放置 <Toaster /> 即可。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── 类型 ────────────────────────────────────────────────────────────
type ToastType = "success" | "error" | "info";

interface ToastItem {
  id:      string;
  type:    ToastType;
  message: string;
  duration: number;
}

// ── 事件总线（无需 Context，降低集成摩擦）──────────────────────────
type ToastListener = (toast: ToastItem) => void;
const listeners = new Set<ToastListener>();

function emit(toast: ToastItem) {
  listeners.forEach(fn => fn(toast));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── 公开 API ────────────────────────────────────────────────────────
export const toast = {
  success: (message: string, duration = 4000) =>
    emit({ id: uid(), type: "success", message, duration }),
  error: (message: string, duration = 5000) =>
    emit({ id: uid(), type: "error", message, duration }),
  info: (message: string, duration = 3500) =>
    emit({ id: uid(), type: "info", message, duration }),
};

// ── ToastItem 样式 ──────────────────────────────────────────────────
const META: Record<ToastType, {
  icon: React.ReactNode;
  bar: string;
  bg:  string;
}> = {
  success: {
    icon: <CheckCircle2 size={15} />,
    bar:  "bg-ok",
    bg:   "border-ok/20",
  },
  error: {
    icon: <XCircle size={15} />,
    bar:  "bg-bad",
    bg:   "border-bad/20",
  },
  info: {
    icon: <Info size={15} />,
    bar:  "bg-brand-1",
    bg:   "border-white/10",
  },
};

const colorClass: Record<ToastType, string> = {
  success: "text-ok",
  error:   "text-bad",
  info:    "text-ink-dim",
};

// ── 单条 Toast ──────────────────────────────────────────────────────
function ToastBubble({
  item,
  onDismiss,
}: {
  item:      ToastItem;
  onDismiss: (id: string) => void;
}) {
  const meta    = META[item.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    onDismiss(item.id);
  }, [item.id, onDismiss]);

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, item.duration);
    return () => clearTimeout(timerRef.current);
  }, [dismiss, item.duration]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "relative flex items-start gap-3 w-full max-w-xs px-4 py-3",
        "rounded-xl border shadow-2xl shadow-black/50 animate-slide-up",
        "bg-surface",
        meta.bg,
      )}
    >
      {/* 左侧色条 */}
      <span className={cn("absolute left-0 top-3 bottom-3 w-[3px] rounded-full", meta.bar)} aria-hidden="true" />

      <span className={cn("shrink-0 mt-[1px]", colorClass[item.type])}>
        {meta.icon}
      </span>

      <p className="flex-1 text-base text-ink leading-snug break-words pr-1">
        {item.message}
      </p>

      <button
        onClick={dismiss}
        className="shrink-0 p-0.5 rounded text-ink-faint hover:text-ink transition-colors"
        aria-label="关闭"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Toaster 容器（放在 layout.tsx 的 body 底部）────────────────────
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const add = useCallback((item: ToastItem) => {
    setItems(prev => [...prev.slice(-4), item]); // 最多同时显示 5 条
  }, []);

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, [add]);

  if (!items.length) return null;

  return (
    <div
      aria-label="通知"
      className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none"
    >
      {items.map(item => (
        <div key={item.id} className="pointer-events-auto">
          <ToastBubble item={item} onDismiss={remove} />
        </div>
      ))}
    </div>
  );
}
