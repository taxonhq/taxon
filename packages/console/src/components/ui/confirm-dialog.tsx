"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "./button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible confirm dialog.
 *
 * A11y features:
 *  - role="dialog" + aria-modal="true" + aria-labelledby/aria-describedby
 *  - Focus is moved into the dialog on open and restored on close
 *  - Focus is trapped: Tab/Shift+Tab cycle within the dialog only
 *  - Escape closes the dialog
 *  - Clicking the backdrop closes the dialog
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  // Restore focus on close + move focus into dialog on open
  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement as HTMLElement | null;
    // 微小延迟，等动画里的元素挂载完
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previousActive?.focus?.();
    };
  }, [open]);

  // Focus trap: keep Tab navigation inside dialog
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
      const last  = focusables[focusables.length - 1];
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
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="relative z-10 w-full max-w-sm mx-4 card-border p-6 space-y-5 animate-scale-in shadow-2xl shadow-black/60"
      >
        {/* Danger stripe at top */}
        {danger && (
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-bad/40 to-transparent rounded-full" aria-hidden="true" />
        )}
        <div className="space-y-2">
          <p id={titleId} className="text-lg font-semibold text-ink">{title}</p>
          {description && (
            <p id={descId} className="text-sm text-ink-sub whitespace-pre-wrap leading-relaxed">{description}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
