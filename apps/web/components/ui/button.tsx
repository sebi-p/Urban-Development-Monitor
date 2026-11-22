import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium no-underline transition-colors disabled:pointer-events-none disabled:opacity-50 hover:no-underline",
  {
    variants: {
      variant: {
        primary: "bg-accent-700 text-white shadow-[var(--shadow-card)] hover:bg-accent-800",
        secondary:
          "border border-slate-300 bg-white text-slate-800 shadow-[var(--shadow-card)] hover:bg-slate-100",
        ghost: "text-slate-700 hover:bg-slate-100",
        danger: "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
      },
      size: { sm: "min-h-9 px-3 text-xs", md: "", icon: "size-11 px-0" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
