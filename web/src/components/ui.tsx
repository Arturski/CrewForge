import type { ReactNode } from "react";

const INPUT = "w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-brand placeholder:text-muted";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT} ${props.className ?? ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT} min-h-[72px] resize-y ${props.className ?? ""}`} />;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} type="button"
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-brand" : "bg-border-strong"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
export function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="grid h-4 w-4 cursor-help place-items-center rounded-full border border-border text-[10px] text-muted" aria-label={text} tabIndex={0}>?</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-border bg-elevated2 px-3 py-2 text-xs leading-snug text-ink opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100">
        {text}
      </span>
    </span>
  );
}

export function LabeledField({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
        {label}{tip && <Tooltip text={tip} />}
      </span>
      {children}
    </label>
  );
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${INPUT} ${props.className ?? ""}`}>{children}</select>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-elevated shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3 font-semibold text-ink">{title}</div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

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
