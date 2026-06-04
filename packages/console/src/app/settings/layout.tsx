"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles, KeyRound, Webhook, SlidersHorizontal, FileCode2, ExternalLink, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 统一设置面（菌丝 v2 · #122 / refinement-2026-06 §3）—— Chrome 式：
 * 持久的左侧分节导航 + 右侧内容区。把原本散在 nav-spine 的配置类目收口到一处，
 * 「使用系统」(spine 5 动词) 与「配置系统」(此处) 彻底分开。
 *
 * 各分节复用既有 /settings/<x> 路由的页面内容，本 layout 只提供左导航外壳，
 * URL 保持 /settings/llm 等（可深链 / ⌘K 直达）。遵守去框原则：左导航是浮于
 * 大地的文字列，不做实心边栏盒子。
 */

const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";

type Section = { href: string; navKey: string; icon: LucideIcon };

const SECTIONS: Section[] = [
  { href: "/settings/llm",      navKey: "llmSettings",    icon: Sparkles },
  { href: "/settings/tokens",   navKey: "apiTokens",      icon: KeyRound },
  { href: "/settings/webhooks", navKey: "webhooks",       icon: Webhook },
  { href: "/settings/system",   navKey: "systemSettings", icon: SlidersHorizontal },
  { href: "/settings/about",    navKey: "about",          icon: Info },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const tNav = useTranslations("nav");
  const pathname = usePathname();

  return (
    <div className="flex gap-8 items-start animate-fade-in">
      {/* ── 左侧分节导航（持久，sticky）──────────────────────────────── */}
      <nav
        aria-label={tNav("sectionSettings")}
        className="w-44 shrink-0 sticky top-[4.6rem] flex flex-col gap-0.5"
      >
        <p className="px-3 pb-1.5 text-2xs uppercase tracking-[0.16em] text-ink-faint">
          {tNav("sectionSettings")}
        </p>

        {SECTIONS.map(({ href, navKey, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-surface-alt text-ink font-medium"
                  : "text-ink-sub hover:text-ink hover:bg-surface-alt/60",
              )}
            >
              <Icon size={15} strokeWidth={1.8} className="shrink-0" />
              <span className="truncate">{tNav(navKey as Parameters<typeof tNav>[0])}</span>
            </Link>
          );
        })}

        {/* API 文档 —— 外链到服务端 Scalar 文档（新标签打开） */}
        <a
          href={`${BASE}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-ink-sub hover:text-ink hover:bg-surface-alt/60 transition-colors"
        >
          <FileCode2 size={15} strokeWidth={1.8} className="shrink-0" />
          <span className="truncate flex-1">{tNav("apiDocs")}</span>
          <ExternalLink size={12} className="text-ink-faint shrink-0" aria-hidden />
        </a>
      </nav>

      {/* ── 内容区 ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
