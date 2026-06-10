import { useEffect, useState } from "react";
import { api, type LlmConfig } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField } from "../components/ui";
import { useToast } from "../lib/toast";

// Models are free-text (type any id) + a Refresh that pulls the provider's LIVE
// model list — so nothing goes stale. The stored wire string is provider/model
// (LiteLLM); we show a transparency note. Presets are just light suggestions.
type Provider = {
  id: string; label: string; prefix: string; baseUrl: string;
  custom?: boolean; noModelList?: boolean; needsKey: boolean; keyHelp: string; suggestions: string[];
};

const PROVIDERS: Provider[] = [
  { id: "openai", label: "OpenAI", prefix: "openai/", baseUrl: "", needsKey: true,
    keyHelp: "platform.openai.com → API keys", suggestions: ["gpt-4o-mini", "gpt-4o", "o3", "o4-mini", "gpt-4.1"] },
  { id: "anthropic", label: "Anthropic", prefix: "anthropic/", baseUrl: "", needsKey: true,
    keyHelp: "console.anthropic.com → API keys", suggestions: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"] },
  { id: "minimax", label: "MiniMax", prefix: "hosted_vllm/", baseUrl: "https://api.minimax.io/v1", needsKey: true, noModelList: true,
    keyHelp: "platform.minimax.io → API key (OpenAI-compatible endpoint, no model-list API)",
    suggestions: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2"] },
  { id: "gemini", label: "Google Gemini", prefix: "gemini/", baseUrl: "", needsKey: true,
    keyHelp: "aistudio.google.com → API key", suggestions: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"] },
  { id: "groq", label: "Groq", prefix: "groq/", baseUrl: "", needsKey: true,
    keyHelp: "console.groq.com → API keys", suggestions: ["llama-3.3-70b-versatile"] },
  { id: "ollama", label: "Ollama (local)", prefix: "ollama/", baseUrl: "http://localhost:11434", needsKey: false,
    keyHelp: "No key needed — runs locally", suggestions: ["llama3.1", "qwen2.5"] },
  { id: "custom", label: "Custom (OpenAI-compatible)", prefix: "", baseUrl: "https://your-endpoint/v1", custom: true, needsKey: true,
    keyHelp: "Any OpenAI-compatible endpoint. Use hosted_vllm/<model>.", suggestions: [] },
];

function providerForWire(wire: string): Provider {
  // exact prefix match (longest first so hosted_vllm/ wins over '')
  const byPrefix = [...PROVIDERS].filter((p) => p.prefix).sort((a, b) => b.prefix.length - a.prefix.length);
  return byPrefix.find((p) => wire.startsWith(p.prefix)) ?? PROVIDERS.find((p) => p.custom)!;
}

// null = editor closed. {} = adding a new connection. {id,...} = editing an existing one.
type Editing = { id?: string } | null;

export function Settings() {
  const toast = useToast();
  const [list, setList] = useState<LlmConfig[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  async function load() {
    try {
      const d = await api.llms();
      setList(d.llms);
      setDefaultId(d.default);
      return d;
    } catch { return null; }
  }
  useEffect(() => { load(); }, []);

  async function setDefault(id: string) {
    await api.setDefaultLlm(id);
    setDefaultId(id);
    toast("Default connection updated", "ok");
  }
  async function remove(c: LlmConfig) {
    if (!confirm(`Delete connection "${c.name}"?`)) return;
    await api.deleteLlm(c.id);
    toast(`Deleted ${c.name}`, "ok");
    load();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Models</h1>
          <p className="text-sm text-muted">The LLM connections that power your agents. Dry-run works with no key; live runs use these. Add as many as you like, then pick one per workflow or per agent.</p>
        </div>
        {!editing && <Button onClick={() => setEditing({})}>+ Add connection</Button>}
      </div>

      {!editing && (
        list.length === 0 ? (
          <Card>
            <div className="p-6 text-center text-sm text-muted">
              No connections yet. <button className="text-brand hover:underline" onClick={() => setEditing({})}>Add one</button> to run live (dry-run works without).
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {list.map((c) => (
              <Card key={c.id}>
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{c.name}</span>
                      {c.id === defaultId && <Badge tone="ok">default</Badge>}
                      {!c.api_key_set && <Badge tone="warn">no key</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      <code className="rounded bg-elevated2 px-1 py-0.5 text-ink">{c.model}</code>
                      {c.base_url ? <> · {c.base_url}</> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.id !== defaultId && <Button variant="ghost" onClick={() => setDefault(c.id)}>Set default</Button>}
                    <Button variant="ghost" onClick={() => setEditing({ id: c.id })}>Edit</Button>
                    <Button variant="ghost" onClick={() => remove(c)}>Delete</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {editing && (
        <ConnectionEditor
          existing={editing.id ? list.find((c) => c.id === editing.id) ?? null : null}
          onCancel={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ConnectionEditor({ existing, onCancel, onSaved }: {
  existing: LlmConfig | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const initialProvider = existing?.model ? providerForWire(existing.model) : PROVIDERS[0];
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [name, setName] = useState(existing?.name ?? "");
  const [model, setModel] = useState(
    existing?.model ? (initialProvider.custom ? existing.model : existing.model.slice(initialProvider.prefix.length)) : (PROVIDERS[0].suggestions[0] ?? ""),
  );
  const [baseUrl, setBaseUrl] = useState(existing?.base_url || initialProvider.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState(existing?.temperature == null ? "" : String(existing.temperature));
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  const wire = provider.custom ? model : provider.prefix + model;

  function pickProvider(p: Provider) {
    setProvider(p);
    setModel(p.custom ? "" : p.suggestions[0] ?? "");
    setBaseUrl(p.baseUrl);
    setFetched(null);
    setTest(null);
  }

  async function refresh() {
    setBusy(true);
    try {
      const d = await api.providerModels({ provider: provider.id, base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}), ...(existing ? { id: existing.id } : {}) });
      if (d.models.length) { setFetched(d.models); toast(`Loaded ${d.models.length} live models`, "ok"); }
      else toast(`${provider.label} didn't return a model list (it may not support /models). Just type the model id, then use Test connection.`, "error");
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  async function runTest() {
    setBusy(true); setTest(null);
    try {
      const r = await api.testLlm({ model: wire, base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}), ...(existing ? { id: existing.id } : {}) });
      setTest(r.ok ? { ok: true, msg: `Connected — model replied: "${r.sample}"` } : { ok: false, msg: r.error ?? "failed" });
    } catch (e) { setTest({ ok: false, msg: String(e) }); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveLlm2({
        ...(existing ? { id: existing.id } : {}),
        name: name.trim() || `${provider.label} · ${model}`,
        model: wire,
        base_url: baseUrl,
        temperature: temperature === "" ? undefined : Number(temperature),
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      toast(existing ? "Connection updated" : "Connection added", "ok");
      onSaved();
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  const showBaseUrl = provider.custom || provider.id === "minimax" || provider.id === "ollama" || !!baseUrl;
  const options = fetched ?? provider.suggestions;

  return (
    <Card>
      <CardHeader title={existing ? "Edit connection" : "New connection"}
        right={existing?.api_key_set ? <Badge tone="ok">key set</Badge> : provider.needsKey ? <Badge tone="warn">needs key</Badge> : undefined} />
      <div className="space-y-4 p-5">
        <LabeledField label="Name" tip="A label you'll recognize when picking this connection per workflow or per agent.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${provider.label} (${model || "model"})`} />
        </LabeledField>

        <LabeledField label="Provider" tip="Where your model runs.">
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <button key={p.id} onClick={() => pickProvider(p)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${provider.id === p.id ? "border-brand bg-brand-soft text-ink" : "border-border text-muted hover:bg-elevated2"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </LabeledField>

        <LabeledField label="Model" tip="Type any model id, or click Refresh to load your provider's current models. Don't trust the suggestions to be up to date.">
          <div className="flex gap-2">
            <Input list="model-options" value={model} onChange={(e) => setModel(e.target.value)}
              placeholder={provider.custom ? "hosted_vllm/your-model" : (provider.suggestions[0] || "model id")} />
            {!provider.noModelList && <Button variant="ghost" onClick={refresh} disabled={busy}>↻ Refresh</Button>}
          </div>
          <datalist id="model-options">{options.map((m) => <option key={m} value={m} />)}</datalist>
          {model && (
            <p className="mt-1 text-[11px] text-muted">
              Sent to the API as <code className="rounded bg-elevated2 px-1 py-0.5 text-ink">{wire}</code>
              {showBaseUrl && baseUrl ? <> · base <code className="rounded bg-elevated2 px-1 py-0.5 text-ink">{baseUrl}</code></> : null}
              {fetched ? <> · <span className="text-ok">{fetched.length} live models loaded</span></> : null}
            </p>
          )}
        </LabeledField>

        {showBaseUrl && (
          <LabeledField label="Base URL" tip="The provider endpoint. Pre-filled; change it for a proxy or self-host.">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.baseUrl} />
          </LabeledField>
        )}

        {provider.needsKey && (
          <LabeledField label="API key" tip={`Encrypted at rest in your local CrewForge store. ${provider.keyHelp}`}>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={existing?.api_key_set ? "•••••• (set — leave blank to keep)" : "paste your key"} />
          </LabeledField>
        )}

        <LabeledField label="Temperature (optional)" tip="0 = focused/deterministic, 1 = creative.">
          <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} className="max-w-[120px]" />
        </LabeledField>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={runTest} disabled={busy || !model}>Test connection</Button>
          <Button onClick={save} disabled={busy || !model}>{existing ? "Save changes" : "Add connection"}</Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
        {test && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${test.ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>
            {test.msg}
          </div>
        )}
        <p className="text-xs text-muted">{provider.keyHelp}{!provider.noModelList && <> · Tip: click <span className="text-ink">Refresh</span> to load current models.</>}</p>
      </div>
    </Card>
  );
}
