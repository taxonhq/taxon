"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Drawer width. sm=400px, md=560px, lg=720px */
  size?: "sm" | "md" | "lg";
  /** Show close button in header */
  showClose?: boolean;
  className?: string;
}

const SIZE_MAP = {
  sm: "w-[400px]",
  md: "w-[560px]",
  lg: "w-[720px]",
} as const;

/**
 * Accessible drawer (side panel) component with focus trap.
 *
 * A11y features:
 *  - role="dialog" + aria-modal="true" + aria-labelledby/aria-describedby
 *  - Focus is moved into the drawer on open and restored on close
 *  - Focus is trapped: Tab/Shift+Tab cycle within the drawer only
 *  - Escape closes the drawer
 *  - Clicking the backdrop closes the drawer
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  showClose = true,
  className,
}: DrawerProps) {
  const t = useTranslations("common");
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus trap + restore focus
  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const focusable = drawerRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      previousActive?.focus?.();
    };
  }, [open]);

  // Focus trap handler
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = drawerRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-end",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      onClick={(e) => { if (e.target === e.currentTarget && open) onClose(); }}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative h-full bg-surface border-l border-edge shadow-2xl shadow-black/40 transition-transform duration-200 ease-out flex flex-col",
          SIZE_MAP[size],
          open ? "translate-x-0" : "translate-x-full",
          className,
        )}
      >
        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-center justify-between gap-4 px-6 h-14 border-b border-edge shrink-0">
            {title && (
              <p id={titleId} className="text-base font-semibold text-ink">{title}</p>
            )}
            {showClose && (
              <button
                onClick={onClose}
                aria-label={t("close")}
                className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors shrink-0 -mr-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {/* Description */}
        {description && (
          <p id={descId} className="px-6 py-3 text-sm text-ink-sub border-b border-edge">{description}</p>
        )}
        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hook: useDrawerFocusTrap ───────────────────────────────────────────────

/**
 * Hook for drawer focus trap behavior.
 */
export function useDrawerFocusTrap(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const focusable = ref.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      previousActive?.focus?.();
    };
  }, [open, ref]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, ref]);
}
