"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 行内信息提示：一个 ⓘ 图标，hover / focus / 点击浮出说明气泡。
 *
 * 用于承载"这个页面/控件是做什么的"这类解释性文字 —— 让标题独自挑大梁，
 * 解释退到渐进式披露（progressive disclosure）里，保持头部干净。
 *
 * 可访问性：图标是真实 button，hint 同时作为 aria-label；气泡 role="tooltip"
 * 并通过 aria-describedby 关联，hover 与键盘 focus 均可触发。
 */
export function InfoHint({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        aria-label={text}
        aria-describedby={open ? id : undefined}
        className="text-ink-faint hover:text-ink transition-colors rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-1/40"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute left-0 top-full mt-2 z-30 w-max max-w-xs rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-normal leading-relaxed text-ink-sub shadow-lg animate-fade-in"
        >
          {text}
        </span>
      )}
    </span>
  );
}
