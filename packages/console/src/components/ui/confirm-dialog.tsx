"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "./button";
import { Dialog } from "./dialog";

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
 * Confirmation dialog built on top of Dialog primitive.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const tCommon = useTranslations("common");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const resolvedConfirmLabel = confirmLabel ?? tCommon("confirm");
  const resolvedCancelLabel  = cancelLabel  ?? tCommon("cancel");

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      showClose={false}
      className={danger ? "relative overflow-hidden" : undefined}
    >
      {/* Danger stripe at top */}
      {danger && (
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-bad/40 to-transparent rounded-full" aria-hidden="true" />
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button ref={cancelRef} variant="outline" size="sm" onClick={onCancel}>
          {resolvedCancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
        >
          {resolvedConfirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
