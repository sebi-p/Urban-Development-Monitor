import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}
