"use client";

import { useRef } from "react";
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
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

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
    </Dialog>
  );
}
