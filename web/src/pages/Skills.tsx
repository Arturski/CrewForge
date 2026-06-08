import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ToolInfo } from "../lib/api";
import { Badge, Card, Input } from "../components/ui";

type Filter = "all" | "builtin" | "mcp";

export function Skills() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => { api.tools().then((d) => setTools(d.tools)).catch(() => {}); }, []);

  const builtin = tools.filter((t) => t.kind !== "mcp");
  const mcp = tools.filter((t) => t.kind === "mcp");
  const filtered = useMemo(() => {
    const base = filter === "builtin" ? builtin : filter === "mcp" ? mcp : tools;
    return base.filter((t) => (t.name + t.description + (t.server ?? "")).toLowerCase().includes(q.toLowerCase()));
  }, [tools, q, filter]);

  const tabs: [Filter, string, number][] = [
    ["all", "All", tools.length], ["builtin", "Built-in", builtin.length], ["mcp", "From MCP", mcp.length],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Skills</h1>
        <p className="max-w-2xl text-sm text-muted">
          Skills are capabilities you attach to an agent — or to a whole workflow (shared by every agent), in the Builder.
          <span className="text-ink"> Built-in</span> skills work out of the box;
          <span className="text-ink"> From-MCP</span> skills come from integrations you connect under{" "}
          <Link to="/mcp" className="text-brand hover:underline">MCP</Link>.
        </p>
      </div>

      {/* explainer strip: the two concepts side by side */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="flex items-start gap-3 p-4">
          <span className="text-lg">🧩</span>
          <div>
            <div className="font-medium text-ink">Skill</div>
            <p className="text-xs text-muted">A capability (search, scrape, query a DB…). Attach to one agent, or to the whole workflow.</p>
          </div>
        </Card>
        <Link to="/mcp" className="block">
          <Card className="flex h-full items-start gap-3 p-4 transition hover:border-border-strong">
            <span className="text-lg">🔌</span>
            <div>
              <div className="font-medium text-ink">MCP integration →</div>
              <p className="text-xs text-muted">A connected server (local or remote) that provides new skills. Manage under MCP.</p>
            </div>
          </Card>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([f, label, n]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${filter === f ? "border-brand bg-brand-soft text-ink" : "border-border text-muted hover:bg-elevated2"}`}>
            {label} <span className="text-muted">{n}</span>
          </button>
        ))}
        <Input className="ml-auto max-w-xs" placeholder="Search skills…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {filter !== "builtin" && mcp.length === 0 && (filter === "mcp" || !q) && (
        <Card className="border-dashed p-4 text-sm text-muted">
          No MCP skills yet. <Link to="/mcp" className="text-brand hover:underline">Connect an integration</Link> to add some.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <Card key={`${t.kind}:${t.server ?? ""}:${t.name}`} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate font-medium text-ink">{t.name}</div>
              {t.kind === "mcp" ? <Badge tone="brand">{t.server}</Badge> : <Badge tone="ok">built-in</Badge>}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{t.description}</p>
          </Card>
        ))}
        {!filtered.length && <div className="text-sm text-muted">No skills match “{q}”.</div>}
      </div>
    </div>
  );
}
