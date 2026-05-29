"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Tag, Layers, ClipboardCheck, Box, LayoutDashboard, Search,
  ChevronLeft, ChevronRight, HelpCircle, KeyRound, Sparkles, User, ShieldCheck, Settings,
} from "lucide-react";
import { NavLink } from "@/components/nav-link";
import { AboutDialog } from "@/components/ui/about-dialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { OnboardingTour, useOnboarding } from "@/components/ui/onboarding";
import { CommandPalette } from "@/components/ui/command-palette";

const W_OPEN   = 216;
const W_CLOSED = 56;

type HealthStatus = "ok" | "degraded" | "checking";

const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";
const SERVICE_DISPLAY = BASE.replace(/^https?:\/\//, "");

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const isDashboard = pathname === "/";
  const [open, setOpen]   = useState(true);
  const [ready, setReady] = useState(false);
  const [health, setHealth] = useState<HealthStatus>("checking");
  const [showAbout, setShowAbout] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Onboarding
  const { showOnboarding, completeOnboarding, mounted: onboardingMounted } = useOnboarding();

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-open");
    if (saved === "false") setOpen(false);
    setReady(true);
  }, []);

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

  const toggle = useCallback(() => {
    setOpen(v => {
      localStorage.setItem("sidebar-open", String(!v));
      return !v;
    });
  }, []);

  // ⌘B / Ctrl+B — toggle sidebar
  // ⌘K / Ctrl+K — open command palette
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [toggle]);

  const w = ready ? (open ? W_OPEN : W_CLOSED) : W_OPEN;

  const isWide =
    pathname.startsWith("/audit") ||
    pathname.startsWith("/entities/") ||
    pathname.startsWith("/governance") ||
    pathname.startsWith("/search");
  const containerClass = isWide ? "max-w-[1200px]" : "max-w-[880px]";

  const dotClass =
    health === "ok"       ? "bg-ok" :
    health === "degraded" ? "bg-bad" :
    "bg-ink-faint animate-pulse";

  const sysT = useTranslations("system");
  const dotTitle =
    health === "ok"       ? sysT("serviceOk") :
    health === "degraded" ? sysT("serviceDegraded") :
    sysT("serviceChecking");

  const NAV_TOP = [
    { href: "/", icon: LayoutDashboard, label: t("dashboard") },
  ] as const;

  const NAV = [
    { href: "/groups",      icon: Layers,        label: t("groups") },
    { href: "/entities",    icon: Box,           label: t("entities") },
    { href: "/search",      icon: Search,        label: t("search") },
    { href: "/audit",       icon: ClipboardCheck, label: t("audit") },
    { href: "/governance",  icon: ShieldCheck,   label: t("governance") },
  ] as const;

  const NAV_BOTTOM = [
    { href: "/settings/llm",    icon: Sparkles,  label: t("llmSettings") },
    { href: "/settings/tokens", icon: KeyRound,  label: t("apiTokens") },
    { href: "/settings/system", icon: Settings,  label: t("systemSettings") },
  ] as const;

  return (
    <div className="flex min-h-screen">
      {/* ── Skip-link for a11y ───────────────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-3 focus:py-2 focus:bg-ink focus:text-surface focus:rounded-lg focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        style={{ width: w, background: "var(--sidebar-bg)" }}
        className="h-screen fixed left-0 top-0 flex flex-col border-r border-edge z-40 overflow-hidden transition-[width] duration-200 ease-in-out"
      >
        {/* Brand with collapse button */}
        <div className="flex items-center border-b border-edge shrink-0" style={{ height: 60, padding: open ? "0 16px" : "0 12px" }}>
          <Link href="/" className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-xl bg-ink flex items-center justify-center shrink-0 shadow-md">
              <Tag size={14} className="text-surface" strokeWidth={2.5} />
            </div>
            {open && (
              <p className="text-lg font-bold text-ink whitespace-nowrap" style={{ letterSpacing: "-0.03em" }}>Taxon</p>
            )}
          </Link>
          <button
            onClick={toggle}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors shrink-0"
          >
            {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        {/* ⌘K search trigger */}
        <button
          onClick={() => setCmdOpen(true)}
          className={`mx-2 mt-2 flex items-center gap-2 rounded-lg border border-edge-mid bg-input text-ink-faint hover:border-edge-strong hover:text-ink-dim transition-all ${open ? "px-3 py-2" : "p-2 justify-center"}`}
          title={open ? undefined : "⌘K"}
          aria-label="Open command palette"
        >
          <Search size={13} className="shrink-0" />
          {open && (
            <>
              <span className="flex-1 text-xs text-left">{t("search")}…</span>
              <kbd className="text-2xs font-mono border border-edge rounded px-1">⌘K</kbd>
            </>
          )}
        </button>

        {/* Nav */}
        <nav aria-label="Main navigation" className="flex-1 px-2 pt-3 pb-2 overflow-hidden space-y-0.5">
          {NAV_TOP.map(({ href, icon: Icon, label }) => (
            <NavLink key={href} href={href} collapsed={!open} title={open ? undefined : label}>
              <Icon size={15} strokeWidth={1.5} />
              {open && label}
            </NavLink>
          ))}

          {open
            ? <p className="px-3 pt-4 pb-1.5 text-2xs font-semibold text-ink-faint uppercase whitespace-nowrap" style={{ letterSpacing: "0.16em" }}>Manage</p>
            : <div className="mx-2 my-2 h-px bg-edge" />
          }

          {NAV.map(({ href, icon: Icon, label }) => (
            <NavLink key={href} href={href} collapsed={!open} title={open ? undefined : label}>
              <Icon size={15} strokeWidth={1.5} />
              {open && label}
            </NavLink>
          ))}

          {open
            ? <p className="px-3 pt-4 pb-1.5 text-2xs font-semibold text-ink-faint uppercase whitespace-nowrap" style={{ letterSpacing: "0.16em" }}>Settings</p>
            : <div className="mx-2 my-2 h-px bg-edge" />
          }

          {NAV_BOTTOM.map(({ href, icon: Icon, label }) => (
            <NavLink key={href} href={href} collapsed={!open} title={open ? undefined : label}>
              <Icon size={15} strokeWidth={1.5} />
              {open && label}
            </NavLink>
          ))}
        </nav>

        {/* ── User slot ────────────────────────────────────────────── */}
        <div
          data-future-user-slot
          className="border-t border-edge shrink-0 flex items-center"
          style={{ padding: open ? "10px 12px" : "10px 0", justifyContent: open ? "flex-start" : "center" }}
        >
          {open ? (
            <div className="flex items-center gap-2.5 min-w-0 w-full">
              <div className="w-7 h-7 rounded-full bg-surface-alt border border-edge-mid flex items-center justify-center shrink-0">
                <User size={13} className="text-ink-faint" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink-dim truncate">—</p>
                <p className="text-2xs text-ink-faint truncate">Dev mode</p>
              </div>
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full bg-surface-alt border border-edge-mid flex items-center justify-center" title="Dev mode">
              <User size={13} className="text-ink-faint" />
            </div>
          )}
        </div>

        {/* ── Service status footer ───────────────────────────────── */}
        <div
          className="border-t border-edge shrink-0 flex items-center"
          style={{ padding: open ? "10px 16px" : "10px 0", justifyContent: open ? "flex-start" : "center" }}
        >
          {open && (
            <div className="flex items-center gap-2 overflow-hidden" title={dotTitle}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${dotClass}`} />
              <span className="text-xs text-ink-sub font-mono whitespace-nowrap truncate">{SERVICE_DISPLAY}</span>
            </div>
          )}
          {!open && (
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${dotClass}`} title={dotTitle} />
          )}
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <main
        id="main-content"
        aria-label="Main content"
        style={{ marginLeft: w }}
        className="flex-1 min-h-screen transition-[margin-left] duration-200 ease-in-out"
      >
        {isDashboard ? (
          children
        ) : (
          <div className={`px-10 py-9 ${containerClass} mx-auto`}>
            {children}
          </div>
        )}
      </main>

      {/* ── 右上角工具栏 ─────────────────────────────────────────── */}
      <div className="fixed top-4 right-5 z-30 flex items-center gap-1">
        <ThemeToggle />
        <button
          onClick={() => setShowAbout(true)}
          title="About"
          className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt border border-transparent hover:border-edge transition-all"
        >
          <HelpCircle size={15} />
        </button>
      </div>

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />

      {onboardingMounted && showOnboarding && (
        <OnboardingTour onComplete={completeOnboarding} />
      )}

      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onToggleSidebar={toggle}
      />
    </div>
  );
}
