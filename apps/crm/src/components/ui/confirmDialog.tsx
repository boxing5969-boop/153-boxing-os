import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, type ButtonVariant } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  onConfirm: () => void;
  pending?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "확인",
  variant = "default",
  onConfirm,
  pending,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="text-sm">{description}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button type="button" variant={variant} onClick={onConfirm} disabled={pending}>
          {pending ? "처리 중…" : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
