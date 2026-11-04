import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Tone = "neutral" | "accent" | "warn" | "danger";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-line/60 text-muted",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

const buttonVariants = {
  primary: "bg-accent text-white hover:opacity-90 dark:text-[#10241a]",
  secondary: "border border-line bg-surface hover:bg-line/40",
  danger: "border border-line bg-surface text-danger hover:bg-danger-soft",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

export function Loading() {
  return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
}
