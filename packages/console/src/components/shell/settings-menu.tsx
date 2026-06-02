"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Settings, Sparkles, KeyRound, Webhook, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 右上角统一「设置」入口（菌丝 v2 · #121 / refinement-2026-06 §3–4）。
 *
 * 把原本散在 nav-spine 里的四个配置类目（LLM / API Token / 事件订阅 / 系统）
 * 从「使用系统」的导航中移走，收口到右上角一个菜单——让 spine 只剩 5 个核心动词。
 *
 * 这是迈向 #122「Chrome 式统一设置面」的过渡形态：当统一设置页落地后，
 * 此菜单可直接替换为指向该页的单一入口。
 */

type SettingsEntry = { href: string; navKey: string; icon: LucideIcon };

const ENTRIES: SettingsEntry[] = [
  { href: "/settings/llm",      navKey: "llmSettings",    icon: Sparkles },
  { href: "/settings/tokens",   navKey: "apiTokens",      icon: KeyRound },
  { href: "/settings/webhooks", navKey: "webhooks",       icon: Webhook },
  { href: "/settings/system",   navKey: "systemSettings", icon: SlidersHorizontal },
];

export function SettingsMenu() {
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const onSettings = pathname.startsWith("/settings");
  const label = tNav("sectionSettings");

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "p-2 rounded-lg transition-all hover:text-ink hover:bg-surface-alt",
          open || onSettings ? "text-ink" : "text-ink-faint",
        )}
      >
        <Settings size={14} strokeWidth={1.8} />
      </button>

      {open && (
        <div role="menu" aria-label={label} className="myc-menu animate-scale-in">
          {ENTRIES.map(({ href, navKey, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => close()}
                className={cn("myc-menu-item", active && "is-active")}
              >
                <Icon size={14} strokeWidth={1.8} className="shrink-0" />
                <span className="flex-1 truncate">{tNav(navKey as Parameters<typeof tNav>[0])}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
