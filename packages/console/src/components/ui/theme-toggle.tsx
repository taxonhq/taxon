"use client";

import { useTranslations } from "next-intl";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const t = useTranslations("theme");
  const label = theme === "dark" ? t("switchToLight") : t("switchToDark");

  return (
    <button
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-all ${className ?? ""}`}
    >
      {theme === "dark"
        ? <Sun  size={14} strokeWidth={1.8} />
        : <Moon size={14} strokeWidth={1.8} />}
    </button>
  );
}
