"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 右上角统一「设置」入口（菌丝 v2 · #122 / refinement-2026-06 §3–4）。
 *
 * 单击进入 /settings 统一设置面（Chrome 式：左分节导航 + 内容区，见 settings/layout.tsx）。
 * 此前 #121 的过渡形态是一个下拉菜单；#122 落地后收敛为指向单页的单一入口。
 */
export function SettingsMenu() {
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const onSettings = pathname.startsWith("/settings");
  const label = tNav("sectionSettings");

  return (
    <Link
      href="/settings"
      aria-label={label}
      title={label}
      aria-current={onSettings ? "page" : undefined}
      className={cn(
        "p-2 rounded-lg transition-all hover:text-ink hover:bg-surface-alt",
        onSettings ? "text-ink" : "text-ink-faint",
      )}
    >
      <Settings size={14} strokeWidth={1.8} />
    </Link>
  );
}
