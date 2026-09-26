import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-[var(--radius)] border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
