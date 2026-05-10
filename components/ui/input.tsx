import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-1)] px-3 text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-vermelho)] disabled:opacity-50",
        mono && "font-mono tabular-nums tracking-[0.01em]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Field = ({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-2">
    <label className="label" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
    {hint && !error && (
      <p className="text-xs text-[var(--color-ink-muted)]">{hint}</p>
    )}
    {error && (
      <p
        className="num text-xs"
        style={{ color: "var(--color-warning)" }}
        role="alert"
      >
        {error}
      </p>
    )}
  </div>
);
