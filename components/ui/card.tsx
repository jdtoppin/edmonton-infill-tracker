import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-white shadow-[0_1px_2px_rgba(20,48,51,0.04)]",
        className,
      )}
      {...props}
    />
  );
}
