"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  /** Dialog width. sm=400px, md=480px, lg=560px */
  size?: "sm" | "md" | "lg";
  /** Show close button in header */
  showClose?: boolean;
  className?: string;
}

const SIZE_MAP = {
  sm: "max-w-[400px]",
  md: "max-w-[480px]",
  lg: "max-w-[560px]",
} as const;

/**
 * Accessible dialog component with focus trap.
 *
 * A11y features:
 *  - role="dialog" + aria-modal="true" + aria-labelledby/aria-describedby
 *  - Focus is moved into the dialog on open and restored on close
 *  - Focus is trapped: Tab/Shift+Tab cycle within the dialog only
 *  - Escape closes the dialog
 *  - Clicking the backdrop closes the dialog
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  showClose = true,
  className,
}: DialogProps) {
  const t = useTranslations("common");
  const dialogRef = useRef<HTMLDivElement>(null);
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
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
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
      const root = dialogRef.current;
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative z-10 w-full mx-4 card-border animate-scale-in shadow-2xl shadow-black/60",
          SIZE_MAP[size],
          className,
        )}
      >
        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
            {title && (
              <p id={titleId} className="text-lg font-semibold text-ink">{title}</p>
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
          <p id={descId} className="px-6 pb-2 text-sm text-ink-sub">{description}</p>
        )}
        {/* Content */}
        <div className="px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Hook: useFocusTrap ─────────────────────────────────────────────────────

/**
 * Hook for focus trap behavior. Useful for custom modal implementations.
 */
export function useFocusTrap(open: boolean, ref: RefObject<HTMLElement | null>) {
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
