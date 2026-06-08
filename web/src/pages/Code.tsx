import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Badge, Button, Card } from "../components/ui";

export function Code() {
  const [params] = useSearchParams();
  const wsId = params.get("ws");
  const [files, setFiles] = useState<Record<string, string>>({});
  const [active, setActive] = useState("");

  useEffect(() => {
    if (!wsId) return;
    api.code(wsId).then((d) => {
      setFiles(d.files);
      setActive(Object.keys(d.files)[0] ?? "");
    }).catch(() => {});
  }, [wsId]);

  if (!wsId) return <div className="text-sm text-muted">Open a workflow's Code view from the Builder.</div>;
  const names = Object.keys(files);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Generated CrewAI project</h1>
          <p className="text-sm text-muted">A standard, runnable crewai project — no lock-in. Edit here or take it with you.</p>
        </div>
        <Button onClick={() => window.open(api.exportUrl(wsId), "_blank")}>⬇ Download .zip</Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[200px_1fr]">
          <div className="border-r border-border bg-elevated2/40">
            {names.map((n) => (
              <button key={n} onClick={() => setActive(n)}
                className={`block w-full px-3 py-2 text-left font-mono text-xs transition ${active === n ? "bg-brand-soft text-ink" : "text-muted hover:bg-elevated2"}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="min-w-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="font-mono text-xs text-muted">{active}</span>
              <Badge tone="ok">read-only</Badge>
            </div>
            <pre className="max-h-[60vh] overflow-auto p-4 text-xs leading-relaxed text-ink">{files[active]}</pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
