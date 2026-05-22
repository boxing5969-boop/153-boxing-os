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
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm",
        // 모바일: 하단 시트 (bottom sheet), 데스크톱: 중앙
        "sm:items-center sm:p-4",
        "animate-fade-in",
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          "relative flex flex-col w-full max-h-[92vh] border border-foreground/10 bg-background shadow-2xl",
          // 모바일: 하단 시트 — 상단만 둥글게, 전체 폭
          "rounded-t-3xl",
          // 데스크톱: 카드처럼 — 모든 모서리 둥글게, 폭 제한
          "sm:max-w-md sm:rounded-2xl",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모바일 그랩 핸들 — iOS 시트 시그니처 */}
        <div className="flex justify-center pt-2 pb-1 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>

        {/* 헤더: 고정 */}
        <div className="flex shrink-0 items-center justify-between border-b border-foreground/10 px-4 py-3">
          <h2 className="font-semibold text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
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
