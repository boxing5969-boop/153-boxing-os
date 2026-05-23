import { type SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        // 모바일 h-11 (44px iOS 권장) → 데스크톱 h-10
        "flex h-11 sm:h-10 w-full rounded-xl border border-foreground/20 bg-background px-3.5 py-2 text-[15px] sm:text-sm",
        "focus:outline-none focus:ring-2 focus:ring-foreground/20",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";
