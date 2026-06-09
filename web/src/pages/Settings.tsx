import { useEffect, useState } from "react";
import { api, type LlmSettings } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField } from "../components/ui";
import { useToast } from "../lib/toast";

// Models are free-text (type any id) + a Refresh that pulls the provider's LIVE
// model list — so nothing goes stale. The stored wire string is provider/model
// (LiteLLM); we show a transparency note. Presets are just light suggestions.
type Provider = {
  id: string; label: string; prefix: string; baseUrl: string;
  custom?: boolean; needsKey: boolean; keyHelp: string; suggestions: string[];
};

const PROVIDERS: Provider[] = [
  { id: "openai", label: "OpenAI", prefix: "openai/", baseUrl: "", needsKey: true,
    keyHelp: "platform.openai.com → API keys", suggestions: ["gpt-4o-mini", "gpt-4o", "o3", "o4-mini", "gpt-4.1"] },
  { id: "anthropic", label: "Anthropic", prefix: "anthropic/", baseUrl: "", needsKey: true,
    keyHelp: "console.anthropic.com → API keys", suggestions: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"] },
  { id: "minimax", label: "MiniMax", prefix: "hosted_vllm/", baseUrl: "https://api.minimax.io/v1", needsKey: true,
    keyHelp: "MiniMax platform → API key (OpenAI-compatible)", suggestions: ["MiniMax-M1", "MiniMax-Text-01", "abab6.5s-chat"] },
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

export function Settings() {
  const toast = useToast();
  const [cfg, setCfg] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [model, setModel] = useState(PROVIDERS[0].suggestions[0]); // bare id (or full wire for custom)
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  const wire = provider.custom ? model : provider.prefix + model;

  useEffect(() => {
    api.getLlm().then((c) => {
      setCfg(c);
      if (c.model) {
        const p = providerForWire(c.model);
        setProvider(p);
        setModel(p.custom ? c.model : c.model.slice(p.prefix.length));
        setBaseUrl(c.base_url || p.baseUrl);
      }
      setTemperature(c.temperature == null ? "" : String(c.temperature));
    }).catch(() => {});
  }, []);

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
      const d = await api.providerModels({ provider: provider.id, base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) });
      if (d.error) toast(`Couldn't load models: ${d.error}`, "error");
      setFetched(d.models);
      if (d.models.length) toast(`Loaded ${d.models.length} live models`, "ok");
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  async function runTest() {
    setBusy(true); setTest(null);
    try {
      const r = await api.testLlm({ model: wire, base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) });
      setTest(r.ok ? { ok: true, msg: `Connected — model replied: "${r.sample}"` } : { ok: false, msg: r.error ?? "failed" });
    } catch (e) { setTest({ ok: false, msg: String(e) }); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveLlm({ model: wire, base_url: baseUrl, temperature: temperature === "" ? undefined : Number(temperature), ...(apiKey ? { api_key: apiKey } : {}) });
      setApiKey("");
      setCfg(await api.getLlm());
      toast(`Saved — ${provider.label} · ${model}`, "ok");
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  const showBaseUrl = provider.custom || provider.id === "minimax" || provider.id === "ollama" || !!baseUrl;
  const options = fetched ?? provider.suggestions;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Models</h1>
        <p className="text-sm text-muted">The LLM that powers your agents. Dry-run works with no key; live runs use this. Pick a provider → choose/refresh a model → add your key.</p>
      </div>

      <Card>
        <CardHeader title="1 · Provider" sub="Where your model runs." />
        <div className="flex flex-wrap gap-2 p-4">
          {PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => pickProvider(p)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${provider.id === p.id ? "border-brand bg-brand-soft text-ink" : "border-border text-muted hover:bg-elevated2"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="2 · Model & key"
          right={cfg?.configured ? <Badge tone="ok">configured</Badge> : <Badge tone="warn">dry-run only</Badge>} />
        <div className="space-y-4 p-5">
          <LabeledField label="Model" tip="Type any model id, or click Refresh to load your provider's current models. Don't trust the suggestions to be up to date.">
            <div className="flex gap-2">
              <Input list="model-options" value={model} onChange={(e) => setModel(e.target.value)}
                placeholder={provider.custom ? "hosted_vllm/your-model" : (provider.suggestions[0] || "model id")} />
              <Button variant="ghost" onClick={refresh} disabled={busy}>↻ Refresh</Button>
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
                placeholder={cfg?.api_key_set ? "•••••• (set — leave blank to keep)" : "paste your key"} />
            </LabeledField>
          )}

          <LabeledField label="Temperature (optional)" tip="0 = focused/deterministic, 1 = creative.">
            <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} className="max-w-[120px]" />
          </LabeledField>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={runTest} disabled={busy || !model}>Test connection</Button>
            <Button onClick={save} disabled={busy || !model}>Save</Button>
          </div>
          {test && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${test.ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>
              {test.msg}
            </div>
          )}
          <p className="text-xs text-muted">{provider.keyHelp} · Tip: click <span className="text-ink">Refresh</span> to load the provider's current models.</p>
        </div>
      </Card>
    </div>
  );
}
