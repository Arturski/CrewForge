import { useEffect, useState } from "react";
import { api, type McpInput, type McpServer, type RegistryServer } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField, Modal, Select } from "../components/ui";
import { useToast } from "../lib/toast";

function toConfig(s: RegistryServer, env: Record<string, string> = {}): McpInput {
  const i = s.install;
  return i.transport === "stdio"
    ? { name: s.title, transport: "stdio", command: i.command, args: i.args, env }
    : { name: s.title, transport: i.transport, url: i.url };
}
const preview = (s: RegistryServer) =>
  s.install.transport === "stdio" ? `${s.install.command} ${(s.install.args ?? []).join(" ")}` : (s.install.url ?? "");

export function Mcp() {
  const toast = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [adding, setAdding] = useState(false);

  function load() { api.mcpServers().then((d) => setServers(d.servers)).catch(() => {}); }
  useEffect(load, []);

  async function removeServer(id: string) {
    if (!confirm("Disconnect this MCP server? Its skills will no longer be available.")) return;
    await api.deleteMcp(id); toast("Disconnected", "ok"); load();
  }

  const toolCount = servers.reduce((n, s) => n + s.tools.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">MCP integrations</h1>
          <p className="max-w-2xl text-sm text-muted">
            MCP servers are integrations (local programs or remote services). Connecting one adds its tools to your{" "}
            <span className="text-ink">Skills</span>, which you then attach to agents. Think of MCP as <em>where skills come from</em>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="brand">{servers.length} connected</Badge>
          <Badge tone="muted">{toolCount} skills provided</Badge>
          <Button variant="ghost" onClick={() => setAdding(true)}>+ Connect manually</Button>
        </div>
      </div>

      <Marketplace onInstalled={load} />

      <Card>
        <CardHeader title="Connected integrations" sub="Each provides one or more skills. Disconnect or re-scan any time." />
        <div className="divide-y divide-border">
          {servers.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{s.name}</span>
                <Badge tone="muted">{s.transport === "stdio" ? "local" : "remote"}</Badge>
                <Badge tone={s.status === "connected" ? "ok" : "danger"}>{s.status}</Badge>
                {s.risk === "high" && <Badge tone="warn">runs local code</Badge>}
                <span className="ml-auto flex gap-3 text-xs">
                  <button onClick={() => api.rescanMcp(s.id).then(load)} className="text-brand hover:underline">re-scan</button>
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
            <div className="px-4 py-6 text-sm text-muted">No integrations connected yet — install one from the marketplace above.</div>
          )}
        </div>
      </Card>

      {adding && <ManualMcpModal onClose={() => setAdding(false)} onAdded={(s) => {
        setAdding(false); load();
        toast(s.status === "connected" ? `Connected — ${s.tools.length} skills added` : `Added, but: ${s.error}`, s.status === "connected" ? "ok" : "error");
      }} />}
    </div>
  );
}

function Marketplace({ onInstalled }: { onInstalled: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RegistryServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [envFor, setEnvFor] = useState<RegistryServer | null>(null);

  async function search(query: string) {
    setLoading(true); setErr(null);
    try { const d = await api.registry(query); setResults(d.servers); if (d.error) setErr(d.error); }
    catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { search(""); }, []);

  async function doInstall(s: RegistryServer, env: Record<string, string>) {
    setInstalling(s.name);
    try {
      const srv = await api.addMcp(toConfig(s, env));
      toast(srv.status === "connected" ? `Connected ${s.title} — ${srv.tools.length} skills added` : `Added, but couldn't connect: ${srv.error}`,
        srv.status === "connected" ? "ok" : "error");
      setEnvFor(null); onInstalled();
    } catch (e) { toast(String(e), "error"); } finally { setInstalling(null); }
  }
  const install = (s: RegistryServer) => s.install.env_required.length ? setEnvFor(s) : doInstall(s, {});

  return (
    <Card>
      <CardHeader title="Marketplace"
        sub="Search the official MCP registry to add an integration (e.g. github, slack, postgres). Connecting it adds its tools to your Skills." />
      <div className="p-4">
        <div className="flex gap-2">
          <Input placeholder="Search integrations — github, filesystem, slack, postgres…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search(q)} />
          <Button onClick={() => search(q)} disabled={loading}>{loading ? "…" : "Search"}</Button>
        </div>
        {err && <div className="mt-3 text-xs text-danger">Registry error: {err}</div>}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {results.map((s) => (
            <div key={s.name} className="rounded-lg border border-border bg-canvas p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-medium text-ink">{s.title}</div>
                <Badge tone={s.install.transport === "stdio" ? "warn" : "muted"}>
                  {s.install.transport === "stdio" ? `local · ${s.install.source}` : "remote"}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{s.description || s.name}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="truncate rounded bg-elevated2 px-1.5 py-0.5 text-[10px] text-muted">{preview(s)}</code>
                <Button className="ml-auto shrink-0 px-2 py-1 text-xs" onClick={() => install(s)} disabled={installing === s.name}>
                  {installing === s.name ? "Connecting…" : "Connect"}
                </Button>
              </div>
            </div>
          ))}
          {!results.length && !loading && <div className="text-sm text-muted">No results.</div>}
        </div>
      </div>
      {envFor && <EnvModal server={envFor} busy={installing === envFor.name}
        onClose={() => setEnvFor(null)} onSubmit={(env) => doInstall(envFor, env)} />}
    </Card>
  );
}

function EnvModal({ server, busy, onClose, onSubmit }: {
  server: RegistryServer; busy: boolean; onClose: () => void; onSubmit: (env: Record<string, string>) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <Modal title={`Configure ${server.title}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-muted">This integration needs the following to connect:</p>
        {server.install.env_required.map((k) => (
          <LabeledField key={k} label={k} tip="Required by this MCP server.">
            <Input value={vals[k] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} placeholder={k} />
          </LabeledField>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(vals)} disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ManualMcpModal({ onClose, onAdded }: { onClose: () => void; onAdded: (s: McpServer) => void }) {
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
      envLines.split("\n").forEach((l) => { const i = l.indexOf("="); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
      const s = await api.addMcp({
        name: name || "mcp-server", transport,
        ...(transport === "stdio" ? { command, args: argsLine.split(/\s+/).filter(Boolean), env } : { url }),
      });
      onAdded(s);
    } catch (e) { toast(String(e), "error"); } finally { setBusy(false); }
  }

  return (
    <Modal title="Connect an MCP server manually" onClose={onClose}>
      <div className="space-y-4">
        <LabeledField label="Name" tip="A label for this integration."><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. filesystem" autoFocus /></LabeledField>
        <LabeledField label="Type" tip="Local = a command on this machine (stdio). Remote = an HTTP/SSE URL.">
          <Select value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)}>
            <option value="stdio">Local command (stdio)</option>
            <option value="sse">Remote (SSE)</option>
            <option value="streamable-http">Remote (streamable HTTP)</option>
          </Select>
        </LabeledField>
        {transport === "stdio" ? (
          <>
            <LabeledField label="Command" tip="The executable, e.g. npx or uvx."><Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" /></LabeledField>
            <LabeledField label="Arguments" tip="Space-separated args."><Input value={argsLine} onChange={(e) => setArgsLine(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" /></LabeledField>
            <LabeledField label="Environment (optional)" tip="One KEY=VALUE per line.">
              <textarea className="w-full rounded-lg border border-border bg-canvas px-3 py-1.5 font-mono text-xs text-ink outline-none focus:border-brand" rows={2} value={envLines} onChange={(e) => setEnvLines(e.target.value)} placeholder="API_TOKEN=..." />
            </LabeledField>
            <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">⚠ Local MCP servers run a command on your machine. Only connect servers you trust.</div>
          </>
        ) : (
          <LabeledField label="Server URL" tip="The MCP endpoint."><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" /></LabeledField>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Connecting…" : "Connect & discover"}</Button>
        </div>
      </div>
    </Modal>
  );
}
