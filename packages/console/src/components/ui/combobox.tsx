"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** Known options to display as suggestions */
  options: string[];
  placeholder?: string;
  /** Label shown as the "clear / universal" option at top of list */
  emptyLabel?: string;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "输入或选择…",
  emptyLabel,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlighted, setHighlighted] = useState<number>(-1);
  // 下拉列表的 fixed 定位坐标
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 避免 SSR hydration 不匹配（portal 只在客户端生效）
  useEffect(() => { setMounted(true); }, []);

  const close = (revert = true) => {
    setOpen(false);
    setHighlighted(-1);
    if (revert) setQuery(value);
  };

  // 计算并更新下拉定位（打开时调用一次，滚动/resize 时也更新）
  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top:      rect.bottom + 4,
      left:     rect.left,
      width:    rect.width,
      zIndex:   9999,
    });
  };

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    // 跟随滚动 / resize 更新位置
    window.addEventListener("scroll",  updatePosition, true);
    window.addEventListener("resize",  updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        close(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, value]); // eslint-disable-line react-hooks/exhaustive-deps -- close 是稳定闭包，无需列入

  const filtered = options.filter(
    o => !query || o.toLowerCase().includes(query.toLowerCase())
  );

  const showCreate = query.trim() !== "" && !options.includes(query.trim());
  const maxIndex   = filtered.length + (showCreate ? 0 : -1);

  const commit = (v: string) => {
    onChange(v);
    setQuery(v);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setOpen(true); e.preventDefault(); }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlighted(h => Math.min(h + 1, maxIndex));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted(h => Math.max(h - 1, emptyLabel ? -1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (highlighted === -1 && emptyLabel) {
          commit("");
        } else if (highlighted >= 0 && highlighted < filtered.length) {
          commit(filtered[highlighted]);
        } else if (highlighted === filtered.length && showCreate) {
          commit(query.trim());
        } else if (query.trim()) {
          commit(query.trim());
        }
        break;
      case "Tab":
        close(false);
        if (query.trim()) onChange(query.trim());
        break;
    }
  };

  const dropdown = (
    <ul
      style={dropdownStyle}
      className="bg-[#111] border border-edge-mid rounded-lg shadow-2xl shadow-black/70 overflow-auto max-h-52 py-1 animate-fade-in"
    >
      {emptyLabel && (
        <li
          onMouseDown={() => commit("")}
          onMouseEnter={() => setHighlighted(-1)}
          className={cn(
            "flex items-center px-3 py-2 text-sm cursor-pointer transition-colors text-ink-sub",
            highlighted === -1 ? "bg-surface-alt text-ink" : "hover:bg-surface-alt hover:text-ink",
          )}
        >
          {emptyLabel}
        </li>
      )}

      {filtered.map((opt, i) => (
        <li
          key={opt}
          onMouseDown={() => commit(opt)}
          onMouseEnter={() => setHighlighted(i)}
          className={cn(
            "flex items-center px-3 py-2 text-sm font-mono cursor-pointer transition-colors",
            highlighted === i ? "bg-surface-alt text-ink" : "text-ink-dim hover:bg-surface-alt hover:text-ink",
          )}
        >
          {opt}
        </li>
      ))}

      {filtered.length === 0 && !query && !emptyLabel && (
        <li className="px-3 py-2 text-xs text-ink-faint select-none">
          暂无已知实体类型，直接输入新类型名
        </li>
      )}

      {showCreate && (
        <li
          onMouseDown={() => commit(query.trim())}
          onMouseEnter={() => setHighlighted(filtered.length)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors",
            filtered.length > 0 && "border-t border-edge",
            highlighted === filtered.length ? "bg-surface-alt text-ink" : "text-ink-dim hover:bg-surface-alt hover:text-ink",
          )}
        >
          <span className="text-2xs text-ink-faint uppercase tracking-wider shrink-0">新建</span>
          <span className="font-mono">{query.trim()}</span>
        </li>
      )}
    </ul>
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Input row */}
      <div
        className={cn(
          "flex items-center w-full px-3 py-2 text-sm bg-input border border-edge-mid rounded-lg",
          "focus-within:border-edge-strong focus-within:ring-2 focus-within:ring-white/[.04]",
          "hover:border-edge-strong/60 transition-all duration-150",
        )}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-ink placeholder:text-ink-faint min-w-0 font-mono"
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center gap-1 ml-1 shrink-0">
          {value && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { commit(""); inputRef.current?.focus(); }}
              className="text-ink-faint hover:text-ink transition-colors"
            >
              <X size={12} />
            </button>
          )}
          <ChevronDown
            size={13}
            className={cn(
              "text-ink-faint transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* 下拉通过 portal 渲染到 body，避免被父容器 overflow:hidden 裁切 */}
      {open && mounted && createPortal(dropdown, document.body)}
    </div>
  );
}
