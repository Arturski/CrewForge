import { useEffect, useMemo, useState } from "react";
import { api, type ToolInfo } from "../lib/api";
import { Badge, Card, Input } from "../components/ui";

export function Tools() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => { api.tools().then((d) => setTools(d.tools)).catch(() => {}); }, []);
  const filtered = useMemo(
    () => tools.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()) || t.description.toLowerCase().includes(q.toLowerCase())),
    [tools, q],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Skills</h1>
          <p className="text-sm text-muted">Capabilities your agents can use. Attach them to agents in the Builder.</p>
        </div>
        <Badge tone="muted">{tools.length} built-in</Badge>
      </div>

      <Card className="border-dashed">
        <div className="flex items-center gap-3 p-4 text-sm text-muted">
          <span className="text-base">🧩</span>
          <div>
            <span className="text-ink">Open skill marketplace (MCP) is coming next</span> — browse the MCP registry,
            see security ratings (mcp-scan), and add skills from GitHub/URL. Transferable across agents.
          </div>
        </div>
      </Card>

      <Input placeholder="Search skills…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <Card key={t.name} className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium text-ink">{t.name}</div>
              <Badge tone="ok">built-in</Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{t.description}</p>
          </Card>
        ))}
        {!filtered.length && <div className="text-sm text-muted">No skills match “{q}”.</div>}
      </div>
    </div>
  );
}
