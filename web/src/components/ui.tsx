import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { HelpCircle, X } from "lucide-react";
import { cn } from "../lib/utils";

// shadcn-style primitives: Radix behavior/a11y + cva variants, styled with the
// CrewForge token system. The public API mirrors the previous hand-built ui so
// existing pages keep working unchanged.

const INPUT =
  "w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm text-ink outline-none transition focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 placeholder:text-muted disabled:opacity-50";

// -- Button ------------------------------------------------------------------
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:brightness-110",
        ghost: "border border-border text-ink hover:bg-elevated2",
        outline: "border border-border-strong text-ink hover:bg-elevated2",
        danger: "bg-danger text-white hover:brightness-110",
      },
      size: { sm: "px-2.5 py-1 text-xs", md: "px-3 py-1.5", icon: "h-8 w-8 p-0" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  children, className, variant, size, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </button>
  );
}

// -- Card --------------------------------------------------------------------
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border bg-elevated", className)}>{children}</div>;
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

// -- Badge / Pill ------------------------------------------------------------
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
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", TONE[tone])}>
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

// -- Inputs ------------------------------------------------------------------
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT, props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(INPUT, "min-h-[72px] resize-y", props.className)} />;
}
export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(INPUT, "cursor-pointer", props.className)}>{children}</select>;
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

// -- Tooltip (Radix: keyboard + touch accessible) ----------------------------
export function Tooltip({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children ?? (
            <button type="button" aria-label={text} className="inline-flex text-muted hover:text-ink">
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6}
            className="z-50 max-w-xs rounded-lg border border-border bg-elevated2 px-3 py-2 text-xs leading-snug text-ink shadow-xl data-[state=delayed-open]:animate-in data-[state=closed]:animate-out fade-in-0 zoom-in-95">
            {text}
            <TooltipPrimitive.Arrow className="fill-elevated2" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// -- Tabs (Radix) ------------------------------------------------------------
export const Tabs = TabsPrimitive.Root;
export function TabsList({ children }: { children: ReactNode }) {
  return (
    <TabsPrimitive.List className="inline-flex items-center gap-1 rounded-lg border border-border bg-elevated p-1">
      {children}
    </TabsPrimitive.List>
  );
}
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger value={value}
      className="rounded-md px-3 py-1.5 text-sm text-muted outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/40 data-[state=active]:bg-brand-soft data-[state=active]:text-ink">
      {children}
    </TabsPrimitive.Trigger>
  );
}
export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  return <TabsPrimitive.Content value={value} className="mt-5 outline-none">{children}</TabsPrimitive.Content>;
}

// -- Toggle (Radix Switch) ---------------------------------------------------
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <SwitchPrimitive.Root checked={checked} onCheckedChange={onChange}
      className={cn("relative h-6 w-11 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-brand/40",
        checked ? "bg-brand" : "bg-border-strong")}>
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

// -- Modal (Radix Dialog) ----------------------------------------------------
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in fade-in-0" />
        <Dialog.Content aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-elevated shadow-2xl data-[state=open]:animate-in fade-in-0 zoom-in-95 focus:outline-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close className="text-muted hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <div className="p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
