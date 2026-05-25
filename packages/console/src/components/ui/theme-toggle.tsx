"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      title={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
      className={`p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-all ${className ?? ""}`}
    >
      {theme === "dark"
        ? <Sun  size={14} strokeWidth={1.8} />
        : <Moon size={14} strokeWidth={1.8} />}
    </button>
  );
}
