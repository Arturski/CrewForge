import { useEffect, useMemo, useState } from "react";
import { api, type McpServer, type ToolInfo } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField, Modal, Select } from "../components/ui";
import { useToast } from "../lib/toast";

export function Tools() {
  const toast = useToast();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  function load() {
    api.tools().then((d) => setTools(d.tools)).catch(() => {});
    api.mcpServers().then((d) => setServers(d.servers)).catch(() => {});
  }
  useEffect(load, []);

  const filtered = useMemo(
    () => tools.filter((t) => (t.name + t.description).toLowerCase().includes(q.toLowerCase())),
    [tools, q],
  );
  const builtinCount = tools.filter((t) => t.kind !== "mcp").length;
  const mcpCount = tools.filter((t) => t.kind === "mcp").length;

  async function removeServer(id: string) {
    if (!confirm("Disconnect this MCP server?")) return;
    await api.deleteMcp(id); toast("Disconnected", "ok"); load();
  }
  async function rescan(id: string) {
    await api.rescanMcp(id); toast("Re-scanned", "ok"); load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Skills</h1>
          <p className="text-sm text-muted">Capabilities your agents can use. Attach them to agents in the Builder.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="muted">{builtinCount} built-in</Badge>
          <Badge tone="brand">{mcpCount} MCP</Badge>
          <Button onClick={() => setAdding(true)}>+ Connect MCP</Button>
        </div>
      </div>

      {/* Connected MCP servers */}
      <Card>
        <CardHeader title="Connected MCP servers"
          sub="Local (stdio) or remote (URL) Model Context Protocol servers. Tools are transferable across agents." />
        <div className="divide-y divide-border">
          {servers.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{s.name}</span>
                <Badge tone="muted">{s.transport}</Badge>
                <Badge tone={s.status === "connected" ? "ok" : "danger"}>{s.status}</Badge>
                <Badge tone={s.risk === "high" ? "warn" : "muted"}>{s.risk === "high" ? "runs local code" : "remote"}</Badge>
                <span className="ml-auto flex gap-3 text-xs">
                  <button onClick={() => rescan(s.id)} className="text-brand hover:underline">re-scan</button>
                  <button onClick={() => removeServer(s.id)} className="text-muted hover:text-danger">disconnect</button>
                </span>
              </div>
              {s.error && <div className="mt-1 text-xs text-danger">{s.error}</div>}
              {s.tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.tools.map((t) => (
                    <span key={t.name} className="rounded-md border border-border bg-elevated2 px-2 py-0.5 text-xs text-ink" title={t.description}>{t.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!servers.length && (
            <div className="px-4 py-6 text-sm text-muted">
              No MCP servers yet. Click <span className="text-brand">+ Connect MCP</span> to add a local command or a remote URL.
            </div>
          )}
        </div>
      </Card>

      {/* Catalog */}
      <Input placeholder="Search all skills…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <Card key={`${t.kind}:${t.server ?? ""}:${t.name}`} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate font-medium text-ink">{t.name}</div>
              {t.kind === "mcp"
                ? <Badge tone="brand">{t.server}</Badge>
                : <Badge tone="ok">built-in</Badge>}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{t.description}</p>
          </Card>
        ))}
        {!filtered.length && <div className="text-sm text-muted">No skills match “{q}”.</div>}
      </div>

      {adding && <AddMcpModal onClose={() => setAdding(false)} onAdded={(s) => {
        setAdding(false); load();
        toast(s.status === "connected" ? `Connected — ${s.tools.length} tools found` : `Added, but: ${s.error}`, s.status === "connected" ? "ok" : "error");
      }} />}
    </div>
  );
}

function AddMcpModal({ onClose, onAdded }: { onClose: () => void; onAdded: (s: McpServer) => void }) {
  const toast = useToast();
  const [transport, setTransport] = useState<"stdio" | "sse" | "streamable-http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsLine, setArgsLine] = useState("");
  const [envLines, setEnvLines] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const env: Record<string, string> = {};
      envLines.split("\n").forEach((l) => {
        const i = l.indexOf("=");
        if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      });
      const s = await api.addMcp({
        name: name || "mcp-server", transport,
        ...(transport === "stdio"
          ? { command, args: argsLine.split(/\s+/).filter(Boolean), env }
          : { url }),
      });
      onAdded(s);
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Connect an MCP server" onClose={onClose}>
      <div className="space-y-4">
        <LabeledField label="Name" tip="A label for this server.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. filesystem" autoFocus />
        </LabeledField>
        <LabeledField label="Type" tip="Local = a command on this machine (stdio). Remote = an HTTP/SSE URL.">
          <Select value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)}>
            <option value="stdio">Local command (stdio)</option>
            <option value="sse">Remote (SSE)</option>
            <option value="streamable-http">Remote (streamable HTTP)</option>
          </Select>
        </LabeledField>

        {transport === "stdio" ? (
          <>
            <LabeledField label="Command" tip="The executable, e.g. npx or uvx. Must be installed on this machine.">
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </LabeledField>
            <LabeledField label="Arguments" tip="Space-separated args passed to the command.">
              <Input value={argsLine} onChange={(e) => setArgsLine(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" />
            </LabeledField>
            <LabeledField label="Environment (optional)" tip="One KEY=VALUE per line (e.g. an API token the server needs).">
              <textarea className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 font-mono text-xs text-ink outline-none focus:border-brand" rows={2}
                value={envLines} onChange={(e) => setEnvLines(e.target.value)} placeholder="API_TOKEN=..." />
            </LabeledField>
            <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
              ⚠ Local MCP servers run a command on your machine with your privileges. Only connect servers you trust.
            </div>
          </>
        ) : (
          <LabeledField label="Server URL" tip="The MCP endpoint, e.g. https://example.com/mcp">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" />
          </LabeledField>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Connecting…" : "Connect & discover"}</Button>
        </div>
      </div>
    </Modal>
  );
}
