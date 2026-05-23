import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // 모바일 h-11 (44px iOS HIG 권장 터치 영역) → 데스크톱 sm: h-10
        "flex h-11 sm:h-10 w-full rounded-xl border border-foreground/20 bg-background px-3.5 py-2 text-[15px] sm:text-sm",
        "transition-colors placeholder:opacity-50",
        "focus:outline-none focus:ring-2 focus:ring-foreground/20",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
