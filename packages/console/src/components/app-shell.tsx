"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Layers, ClipboardCheck, Box, LayoutDashboard, Search,
  HelpCircle, KeyRound, Sparkles, ShieldCheck, Settings,
} from "lucide-react";
import { AboutDialog } from "@/components/ui/about-dialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { OnboardingTour, useOnboarding } from "@/components/ui/onboarding";
import { CommandPalette } from "@/components/ui/command-palette";
import { MycCanvas } from "@/components/shell/myc-canvas";

type HealthStatus = "ok" | "degraded" | "checking";

const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";
const SERVICE_DISPLAY = BASE.replace(/^https?:\/\//, "");

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const sysT = useTranslations("system");
  const pathname = usePathname();
  const isDashboard = pathname === "/";

  const [health, setHealth] = useState<HealthStatus>("checking");
  const [showAbout, setShowAbout] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Onboarding
  const { showOnboarding, completeOnboarding, mounted: onboardingMounted } = useOnboarding();

  // Live health check — poll every 30 s ± 5s jitter
  useEffect(() => {
    const check = () => {
      fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) })
        .then(r => setHealth(r.ok ? "ok" : "degraded"))
        .catch(() => setHealth("degraded"));
    };
    check();
    const jitter = Math.random() * 10000 - 5000;
    const id = setInterval(check, 30_000 + jitter);
    return () => clearInterval(id);
  }, []);

  // ⌘K / Ctrl+K — open command palette
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── 导航即菌丝：单列发光节点（含图标 + hover/激活标签）──────────────────
  const NAV = [
    { href: "/",                icon: LayoutDashboard, label: t("dashboard") },
    { href: "/groups",          icon: Layers,          label: t("groups") },
    { href: "/entities",        icon: Box,             label: t("entities") },
    { href: "/search",          icon: Search,          label: t("search") },
    { href: "/audit",           icon: ClipboardCheck,  label: t("audit") },
    { href: "/governance",      icon: ShieldCheck,     label: t("governance") },
    { href: "/settings/llm",    icon: Sparkles,        label: t("llmSettings") },
    { href: "/settings/tokens", icon: KeyRound,        label: t("apiTokens") },
    { href: "/settings/system", icon: Settings,        label: t("systemSettings") },
  ] as const;

  const isActive = useCallback(
    (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")),
    [pathname],
  );

  const dotClass =
    health === "ok"       ? "ok" :
    health === "degraded" ? "bad" :
    "checking";
  const dotTitle =
    health === "ok"       ? sysT("serviceOk") :
    health === "degraded" ? sysT("serviceDegraded") :
    sysT("serviceChecking");

  return (
    <>
      {/* ── Skip-link for a11y ───────────────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-3 focus:py-2 focus:bg-ink focus:text-surface focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* ── 有机体画布（密集页背景；仪表盘改用真实数据驱动的有机体 hero，
             故此处不渲染装饰版，避免真假两张网络并存的混淆）────────────── */}
      {!isDashboard && <MycCanvas dim />}

      {/* ── 悬浮品牌 ─────────────────────────────────────────────── */}
      <Link href="/" className="myc-brand" aria-label="Taxon — 首页">
        <span className="spore" />
        Taxon
      </Link>

      {/* ── 导航即菌丝（发光节点串）──────────────────────────────── */}
      <nav className="myc-spine" aria-label="Main navigation">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              data-l={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`myc-gnode${active ? " on" : ""}`}
            >
              <Icon strokeWidth={2} />
            </Link>
          );
        })}
      </nav>

      {/* ── 状态簇（右上）────────────────────────────────────────── */}
      <div className="myc-status">
        <span className="myc-pill" title={dotTitle}>
          <span className={`d ${dotClass}`} />
          <span style={{ fontFamily: "var(--font-myc-mono)" }}>{SERVICE_DISPLAY}</span>
        </span>
        <ThemeToggle />
        <button className="myc-ghost" onClick={() => setShowAbout(true)} title="About" aria-label="About">
          <HelpCircle size={14} />
        </button>
      </div>

      {/* ── 命令提示（右下）──────────────────────────────────────── */}
      <button className="myc-cmd" onClick={() => setCmdOpen(true)} aria-label="Open command palette">
        <kbd>⌘K</kbd> {t("search")}
      </button>

      {/* ── 内容区 ───────────────────────────────────────────────── */}
      <main id="main-content" aria-label="Main content" className="myc-main">
        {isDashboard ? (
          <div className="myc-hero">{children}</div>
        ) : (
          <div className="myc-sheet">{children}</div>
        )}
      </main>

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />

      {onboardingMounted && showOnboarding && (
        <OnboardingTour onComplete={completeOnboarding} />
      )}

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}
