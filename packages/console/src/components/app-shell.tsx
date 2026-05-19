"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Tag, Layers, ClipboardCheck, Box,
  ChevronLeft, ChevronRight, HelpCircle,
} from "lucide-react";
import { NavLink } from "@/components/nav-link";
import { AboutDialog } from "@/components/ui/about-dialog";

const W_OPEN   = 216;
const W_CLOSED = 56;

const NAV = [
  { href: "/groups",   icon: Layers,        label: "分组管理" },
  { href: "/entities", icon: Box,           label: "实体管理" },
  { href: "/audit",    icon: ClipboardCheck, label: "审核队列" },
] as const;

type HealthStatus = "ok" | "degraded" | "checking";

const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? "http://localhost:3300";
const SERVICE_DISPLAY = BASE.replace(/^https?:\/\//, "");

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen]   = useState(true);
  const [ready, setReady] = useState(false);
  const [health, setHealth] = useState<HealthStatus>("checking");
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sidebar-open");
    if (saved === "false") setOpen(false);
    setReady(true);
  }, []);

  // Live health check — poll every 30 s
  useEffect(() => {
    const check = () => {
      fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) })
        .then(r => setHealth(r.ok ? "ok" : "degraded"))
        .catch(() => setHealth("degraded"));
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const toggle = () =>
    setOpen(v => {
      localStorage.setItem("sidebar-open", String(!v));
      return !v;
    });

  const w = ready ? (open ? W_OPEN : W_CLOSED) : W_OPEN;

  const dotClass =
    health === "ok"       ? "bg-ok" :
    health === "degraded" ? "bg-bad" :
    "bg-ink-faint animate-pulse";

  const dotTitle =
    health === "ok"       ? "服务正常" :
    health === "degraded" ? "服务异常" :
    "检测中…";

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        style={{ width: w, background: "var(--sidebar-bg)" }}
        className="h-screen fixed left-0 top-0 flex flex-col border-r border-edge z-40 overflow-hidden transition-[width] duration-200 ease-in-out"
      >
        {/* Brand */}
        <div className="flex items-center border-b border-edge shrink-0" style={{ height: 60, padding: open ? "0 16px" : "0 12px" }}>
          <Link href="/" className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-ink flex items-center justify-center shrink-0 shadow-[0_2px_4px_rgba(0,0,0,.4)]">
              <Tag size={14} className="text-surface" strokeWidth={2.5} />
            </div>
            {open && (
              <p className="text-[17px] font-bold text-ink whitespace-nowrap" style={{ letterSpacing: "-0.03em" }}>Taxcon</p>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 pt-4 pb-2 space-y-0.5 overflow-hidden">
          {open && (
            <p className="px-3 pb-2 text-[9px] font-semibold text-ink-faint uppercase whitespace-nowrap" style={{ letterSpacing: "0.16em" }}>
              管理
            </p>
          )}
          {NAV.map(({ href, icon: Icon, label }) => (
            <NavLink key={href} href={href} collapsed={!open} title={open ? undefined : label}>
              <Icon size={15} strokeWidth={1.5} />
              {open && label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="border-t border-edge shrink-0 flex items-center gap-1"
          style={{ padding: open ? "10px 12px" : "10px 0", justifyContent: open ? "space-between" : "center" }}
        >
          {open && (
            <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0" title={dotTitle}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 ${dotClass}`} />
              <span className="text-[11px] text-ink-sub font-mono whitespace-nowrap truncate">{SERVICE_DISPLAY}</span>
            </div>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => setShowAbout(true)}
              title="关于"
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
            >
              <HelpCircle size={14} />
            </button>
            <button
              onClick={toggle}
              title={open ? "收起侧边栏" : "展开侧边栏"}
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
            >
              {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
        </div>

        <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />
      </aside>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <main
        style={{ marginLeft: w }}
        className="flex-1 min-h-screen transition-[margin-left] duration-200 ease-in-out"
      >
        <div className="px-10 py-9 max-w-[880px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
