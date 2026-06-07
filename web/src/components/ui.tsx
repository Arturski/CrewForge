import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-elevated ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <div className="font-semibold text-ink">{title}</div>
        {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Button({
  children, onClick, variant = "primary", disabled, className = "",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost"; disabled?: boolean; className?: string;
}) {
  const base = "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = variant === "primary"
    ? "bg-brand text-white hover:brightness-110"
    : "border border-border text-ink hover:bg-elevated2";
  return (
    <button className={`${base} ${styles} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const TONE: Record<string, string> = {
  ok: "text-ok border-ok/30 bg-ok/10",
  running: "text-running border-running/30 bg-running/10",
  warn: "text-warn border-warn/30 bg-warn/10",
  danger: "text-danger border-danger/30 bg-danger/10",
  muted: "text-muted border-border bg-elevated2",
  brand: "text-brand border-brand/30 bg-brand/10",
};

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated2 px-2.5 py-1 text-xs">
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}
