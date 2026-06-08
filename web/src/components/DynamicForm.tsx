import { useState } from "react";
import type { FieldSpec } from "../lib/api";
import { Badge } from "./ui";

// Renders a config form purely from the introspected manifest. No field is
// hardcoded — this is CrewForge's compatibility engine made visible. Controlled:
// the parent owns `values` and receives changes via `onChange`.

function Control({ f, value, onChange }: { f: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const c = f.ui.control;
  const base = "w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm text-ink outline-none focus:border-brand";

  if (c === "toggle") {
    return (
      <button type="button" onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full transition ${value ? "bg-brand" : "bg-border-strong"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    );
  }
  if (c === "textarea")
    return <textarea className={`${base} min-h-[64px] resize-y`} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (c === "number")
    return <input type="number" className={base} value={(value as number) ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  if (c === "select")
    return (
      <select className={base} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {f.ui.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  if (c === "list")
    return <input className={base} placeholder="comma,separated" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (c === "json" || c === "keyvalue" || c === "nested")
    return <textarea className={`${base} font-mono text-xs min-h-[48px]`} placeholder={f.ui.note ?? "JSON"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  return <input className={base} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export function DynamicForm({
  fields, values, onChange, hideNames = [],
}: {
  fields: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  hideNames?: string[];
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const usable = fields.filter((f) => !hideNames.includes(f.name));
  const common = usable.filter((f) => ["text", "textarea", "toggle", "number", "select"].includes(f.ui.control));
  const advanced = usable.filter((f) => !common.includes(f));
  const visible = showAdvanced ? usable : common;

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {visible.map((f) => (
          <div key={f.name} className={["textarea", "json", "keyvalue", "nested"].includes(f.ui.control) ? "md:col-span-2" : ""}>
            <div className="mb-1 flex items-center gap-2">
              <label className="text-xs font-medium text-ink">{f.name}</label>
              {f.required && <Badge tone="brand">required</Badge>}
              <span className="ml-auto font-mono text-[10px] text-muted">{f.ui.control}{f.ui.numeric ? `:${f.ui.numeric}` : ""}</span>
            </div>
            <Control f={f} value={values[f.name]} onChange={(v) => onChange(f.name, v)} />
          </div>
        ))}
      </div>
      {advanced.length > 0 && (
        <button onClick={() => setShowAdvanced((s) => !s)} className="mt-4 text-sm text-brand hover:underline">
          {showAdvanced ? "Hide advanced fields" : `Show all ${usable.length} manifest fields (+${advanced.length} advanced)`}
        </button>
      )}
    </div>
  );
}
