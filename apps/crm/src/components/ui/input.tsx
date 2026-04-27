import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm",
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
