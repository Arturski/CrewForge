import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api, type McpInput, type McpServer, type RegistryServer, type ToolConfig, type ToolInfo,
} from "../lib/api";
import {
  Badge, Button, Card, CardHeader, Input, LabeledField, Modal, Select, Tooltip,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "../components/ui";
import type { SecurityAssessment } from "../lib/api";
import { useToast } from "../lib/toast";
import { Bot, Plug, Puzzle, ArrowRight, ShieldAlert, ShieldCheck } from "lucide-react";

const SEC_TONE = { high: "warn", medium: "muted", low: "ok" } as const;

function SecurityBadge({ sec }: { sec?: SecurityAssessment }) {
  if (!sec) return null;
  const Icon = sec.level === "high" ? ShieldAlert : ShieldCheck;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={SEC_TONE[sec.level]}>
        <Icon className="mr-1 h-3 w-3" />{sec.label}
      </Badge>
      <Tooltip text={`Security: ${sec.factors.join(" · ")}`} />
    </span>
  );
}

// One hub for capabilities. Mental model, made explicit:
//   Integrations (MCP)  →provide→  Tools  →attached to→  Agents
// "Tools" is the single capability concept (matches CrewAI + the export).

export function Tools() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "integrations" ? "integrations" : "tools";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Tools</h1>
        <p className="max-w-2xl text-sm text-muted">
          Tools are the capabilities your agents can use (search the web, read files, query a database…).
          You attach them to agents — or a whole workflow — in the Builder.
        </p>
      </div>

      <FlowStrip />

      <Tabs value={tab} onValueChange={(v) => setParams(v === "integrations" ? { tab: "integrations" } : {})}>
        <TabsList>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="integrations">Integrations (MCP)</TabsTrigger>
        </TabsList>
        <TabsContent value="tools"><ToolCatalog /></TabsContent>
        <TabsContent value="integrations"><Integrations /></TabsContent>
      </Tabs>
    </div>
  );
}

function FlowStrip() {
  const step = (icon: React.ReactNode, label: string, sub: string) => (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
      {icon}
      <div><div className="text-xs font-medium text-ink">{label}</div><div className="text-[10px] text-muted">{sub}</div></div>
    </div>
  );
  const arrow = (t: string) => (
    <div className="flex flex-col items-center text-muted"><ArrowRight className="h-4 w-4" /><span className="text-[9px]">{t}</span></div>
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {step(<Plug className="h-4 w-4 text-running" />, "Integrations (MCP)", "external services")}
      {arrow("provide")}
      {step(<Puzzle className="h-4 w-4" style={{ color: "var(--color-node-task)" }} />, "Tools", "capabilities")}
      {arrow("attached to")}
      {step(<Bot className="h-4 w-4" style={{ color: "var(--color-node-agent)" }} />, "Agents", "in the Builder")}
    </div>
  );
}

// ---- Tools tab: the attachable catalog -------------------------------------
type Filter = "all" | "builtin" | "mcp";

function ToolCatalog() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [, setParams] = useSearchParams();

  const load = () => api.tools().then((d) => setTools(d.tools)).catch(() => {});
  useEffect(() => { load(); }, []);

  const builtin = tools.filter((t) => t.kind !== "mcp");
  const mcp = tools.filter((t) => t.kind === "mcp");
  const filtered = useMemo(() => {
    const base = filter === "builtin" ? builtin : filter === "mcp" ? mcp : tools;
    return base.filter((t) => (t.name + t.description + (t.server ?? "")).toLowerCase().includes(q.toLowerCase()));
  }, [tools, q, filter]);

  const tabs: [Filter, string, number][] = [
    ["all", "All", tools.length], ["builtin", "Built-in", builtin.length], ["mcp", "From integrations", mcp.length],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(([f, label, n]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${filter === f ? "border-brand bg-brand-soft text-ink" : "border-border text-muted hover:bg-elevated2"}`}>
            {label} <span className="text-muted">{n}</span>
          </button>
        ))}
        <Input className="ml-auto max-w-xs" placeholder="Search tools…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {mcp.length === 0 && filter !== "builtin" && (
        <Card className="border-dashed p-4 text-sm text-muted">
          Want more tools? <button onClick={() => setParams({ tab: "integrations" })} className="text-brand hover:underline">Connect an integration</button> to add some.
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <Card key={`${t.kind}:${t.server ?? ""}:${t.name}`} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate font-medium text-ink">{t.name}</div>
              {t.kind === "mcp" ? <Badge tone="brand">{t.server}</Badge>
                : t.missing_env?.length ? <Badge tone="warn">needs key</Badge>
                : t.configured ? <Badge tone="ok">ready</Badge>
                : <Badge tone="ok">built-in</Badge>}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{t.description}</p>
            {t.kind !== "mcp" && (t.env_vars?.length || t.params?.length) ? (
              <button onClick={() => setConfiguring(t.name)} className="mt-2 text-xs text-brand hover:underline">
                {t.configured ? "Edit configuration" : "Configure"}
                {t.missing_env?.length ? ` (${t.missing_env.join(", ")})` : ""}
              </button>
            ) : null}
          </Card>
        ))}
        {!filtered.length && <div className="text-sm text-muted">No tools match “{q}”.</div>}
      </div>

      {configuring && (
        <ToolConfigModal name={configuring} onClose={() => setConfiguring(null)}
          onSaved={() => { setConfiguring(null); load(); }} />
      )}
    </div>
  );
}

function ToolConfigModal({ name, onClose, onSaved }: {
  name: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [cfg, setCfg] = useState<ToolConfig | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [env, setEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    api.builtinTool(name).then((c) => {
      setCfg(c);
      setArgs(Object.fromEntries(Object.entries(c.config.args).map(([k, v]) => [k, String(v)])));
      setEnv(c.config.env);
    }).catch((e) => { toast(String(e), "error"); onClose(); });
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!cfg) return;
    const typed: Record<string, unknown> = {};
    for (const p of cfg.params) {
      const raw = (args[p.name] ?? "").trim();
      if (!raw) continue;
      typed[p.name] = p.type === "integer" ? parseInt(raw, 10)
        : p.type === "number" ? parseFloat(raw)
        : p.type === "boolean" ? raw === "true"
        : raw;
    }
    try { await api.setBuiltinToolConfig(name, { args: typed, env }); toast("Saved", "ok"); onSaved(); }
    catch (e) { toast(String(e), "error"); }
  }
  async function clear() {
    try { await api.deleteBuiltinToolConfig(name); toast("Configuration removed", "ok"); onSaved(); }
    catch (e) { toast(String(e), "error"); }
  }

  return (
    <Modal title={`Configure ${name}`} onClose={onClose}>
      {!cfg ? <div className="py-8 text-center text-sm text-muted">Loading…</div> : (
        <div className="space-y-4">
          {cfg.env_vars.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted">API keys (encrypted at rest)</div>
              {cfg.env_vars.map((e) => (
                <LabeledField key={e.name} label={`${e.name}${e.required ? "" : " (optional)"}`}>
                  <Input type="password" placeholder={env[e.name] === "•••" ? "saved — leave to keep" : "paste key"}
                    value={env[e.name] ?? ""} onChange={(ev) => setEnv({ ...env, [e.name]: ev.target.value })} />
                </LabeledField>
              ))}
            </div>
          )}
          {cfg.params.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Options (blank = tool default)</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {cfg.params.map((p) => (
                  <LabeledField key={p.name} label={p.name}>
                    {p.type === "boolean" ? (
                      <Select value={args[p.name] ?? ""} onChange={(e) => setArgs({ ...args, [p.name]: e.target.value })}>
                        <option value="">default{p.default != null ? ` (${String(p.default)})` : ""}</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </Select>
                    ) : (
                      <Input type={p.type === "string" ? "text" : "number"}
                        placeholder={p.default != null ? String(p.default) : p.type}
                        value={args[p.name] ?? ""} onChange={(e) => setArgs({ ...args, [p.name]: e.target.value })} />
                    )}
                  </LabeledField>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={clear}>Clear configuration</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- Integrations tab: MCP marketplace + connected servers -----------------
function toConfig(s: RegistryServer, env: Record<string, string> = {}): McpInput {
  const i = s.install;
  return i.transport === "stdio"
    ? { name: s.title, transport: "stdio", command: i.command, args: i.args, env }
    : { name: s.title, transport: i.transport, url: i.url };
}
const preview = (s: RegistryServer) =>
  s.install.transport === "stdio" ? `${s.install.command} ${(s.install.args ?? []).join(" ")}` : (s.install.url ?? "");

function Integrations() {
  const toast = useToast();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [adding, setAdding] = useState(false);
  function load() { api.mcpServers().then((d) => setServers(d.servers)).catch(() => {}); }
  useEffect(load, []);

  async function removeServer(id: string) {
    if (!confirm("Disconnect this integration? Its tools will no longer be available.")) return;
    await api.deleteMcp(id); toast("Disconnected", "ok"); load();
  }

  return (
    <div className="space-y-5">
      <Card className="border-dashed">
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            Integrations are external services (MCP servers, local or remote). Connecting one adds its tools to the <span className="text-ink">Tools</span> tab.
          </p>
          <Button variant="ghost" onClick={() => setAdding(true)}>+ Connect manually</Button>
        </div>
      </Card>

      <Marketplace onInstalled={load} />

      <Card>
        <CardHeader title="Connected integrations" sub="Each provides one or more tools. Disconnect or re-scan any time." />
        <div className="divide-y divide-border">
          {servers.map((s) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{s.name}</span>
                <Badge tone={s.status === "connected" ? "ok" : "danger"}>{s.status}</Badge>
                <SecurityBadge sec={s.security} />
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
          {!servers.length && <div className="px-4 py-6 text-sm text-muted">No integrations connected yet — install one from the marketplace above.</div>}
        </div>
      </Card>

      {adding && <ManualMcpModal onClose={() => setAdding(false)} onAdded={(s) => {
        setAdding(false); load();
        toast(s.status === "connected" ? `Connected — ${s.tools.length} tools added` : `Added, but: ${s.error}`, s.status === "connected" ? "ok" : "error");
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
      toast(srv.status === "connected" ? `Connected ${s.title} — ${srv.tools.length} tools added` : `Added, but couldn't connect: ${srv.error}`,
        srv.status === "connected" ? "ok" : "error");
      setEnvFor(null); onInstalled();
    } catch (e) { toast(String(e), "error"); } finally { setInstalling(null); }
  }
  const install = (s: RegistryServer) => s.install.env_required.length ? setEnvFor(s) : doInstall(s, {});

  return (
    <Card>
      <CardHeader title="Marketplace"
        sub="Search the official MCP registry to add an integration (e.g. github, slack, postgres). Connecting it adds its tools to the Tools tab." />
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
                <SecurityBadge sec={s.security} />
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{s.description || s.name}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="truncate rounded bg-elevated2 px-1.5 py-0.5 text-[10px] text-muted">{preview(s)}</code>
                <Button className="ml-auto shrink-0" size="sm" onClick={() => install(s)} disabled={installing === s.name}>
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
    <Modal title="Connect an integration manually" onClose={onClose}>
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
            <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">⚠ Local integrations run a command on your machine. Only connect ones you trust.</div>
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
