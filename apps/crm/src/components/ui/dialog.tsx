import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative flex flex-col w-full max-w-md max-h-[90vh] rounded-lg border border-foreground/10 bg-background shadow-lg",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더: 고정 */}
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-4 py-3">
          <h2 className="font-semibold text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="opacity-60 hover:opacity-100"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* 본문: 스크롤 가능 */}
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
