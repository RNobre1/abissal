import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium uppercase tracking-[0.18em] transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-vermelho)]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-vermelho)] text-[var(--color-ink-display)] hover:bg-[var(--color-vermelho-hi)]",
        depth:
          "bg-[var(--color-depth)] text-[var(--color-ink-display)] hover:bg-[var(--color-depth-hi)]",
        ghost:
          "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
        outline:
          "border border-[var(--color-line-strong)] bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]",
        danger:
          "bg-transparent text-[var(--color-warning)] hover:bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)]",
      },
      size: {
        sm: "h-8 px-3 text-[10px]",
        md: "h-10 px-4 text-xs",
        lg: "h-12 px-6 text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
