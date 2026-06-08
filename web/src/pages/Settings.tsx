import { useEffect, useState } from "react";
import { api, type LlmSettings } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField } from "../components/ui";
import { useToast } from "../lib/toast";

// Provider presets. `model` strings are LiteLLM-style (provider/model); CrewAI
// routes them automatically. OpenAI-compatible providers (MiniMax, custom) use
// the `openai/<model>` prefix against a base_url.
type Provider = {
  id: string; label: string; models: string[]; baseUrl: string;
  needsKey: boolean; keyHelp: string;
};
const PROVIDERS: Provider[] = [
  { id: "openai", label: "OpenAI", models: ["openai/gpt-4o-mini", "openai/gpt-4o", "openai/o3-mini"], baseUrl: "", needsKey: true, keyHelp: "platform.openai.com → API keys" },
  { id: "anthropic", label: "Anthropic", models: ["anthropic/claude-3-5-sonnet-latest", "anthropic/claude-3-5-haiku-latest"], baseUrl: "", needsKey: true, keyHelp: "console.anthropic.com → API keys" },
  { id: "minimax", label: "MiniMax", models: ["openai/MiniMax-M1", "openai/MiniMax-Text-01", "openai/abab6.5s-chat"], baseUrl: "https://api.minimax.io/v1", needsKey: true, keyHelp: "MiniMax platform → API key (uses the OpenAI-compatible endpoint)" },
  { id: "gemini", label: "Google Gemini", models: ["gemini/gemini-1.5-pro", "gemini/gemini-1.5-flash"], baseUrl: "", needsKey: true, keyHelp: "aistudio.google.com → API key" },
  { id: "groq", label: "Groq", models: ["groq/llama-3.3-70b-versatile"], baseUrl: "", needsKey: true, keyHelp: "console.groq.com → API keys" },
  { id: "ollama", label: "Ollama (local)", models: ["ollama/llama3.1", "ollama/qwen2.5"], baseUrl: "http://localhost:11434", needsKey: false, keyHelp: "No key needed — runs locally" },
  { id: "custom", label: "Custom (OpenAI-compatible)", models: ["openai/your-model"], baseUrl: "https://your-endpoint/v1", needsKey: true, keyHelp: "Any OpenAI-compatible endpoint (vLLM, LM Studio, proxy…)" },
];

function providerForModel(model: string): Provider {
  return PROVIDERS.find((p) => p.models.includes(model))
    ?? PROVIDERS.find((p) => model.startsWith(p.id))
    ?? PROVIDERS[0];
}

export function Settings() {
  const toast = useToast();
  const [cfg, setCfg] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [model, setModel] = useState(PROVIDERS[0].models[0]);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    api.getLlm().then((c) => {
      setCfg(c);
      if (c.model) {
        const p = providerForModel(c.model);
        setProvider(p); setModel(c.model);
        setBaseUrl(c.base_url || p.baseUrl);
      }
      setTemperature(c.temperature == null ? "" : String(c.temperature));
    }).catch(() => {});
  }, []);

  function pickProvider(p: Provider) {
    setProvider(p);
    setModel(p.models[0]);
    setBaseUrl(p.baseUrl);
    setTest(null);
  }

  async function runTest() {
    setBusy(true); setTest(null);
    try {
      const r = await api.testLlm({ model, base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) });
      setTest(r.ok ? { ok: true, msg: `Connected — model replied: "${r.sample}"` } : { ok: false, msg: r.error ?? "failed" });
    } catch (e) { setTest({ ok: false, msg: String(e) }); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveLlm({ model, base_url: baseUrl, temperature: temperature === "" ? undefined : Number(temperature), ...(apiKey ? { api_key: apiKey } : {}) });
      setApiKey("");
      setCfg(await api.getLlm());
      toast("Saved", "ok");
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Models</h1>
        <p className="text-sm text-muted">The LLM that powers your agents. Dry-run works with no key; live runs use this. Three steps: pick a provider → choose a model → add your key.</p>
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
          <LabeledField label="Model" tip="The exact model id. The presets for this provider are suggestions — you can type any supported id.">
            <Input list="models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider.models[0]} />
            <datalist id="models">{provider.models.map((m) => <option key={m} value={m} />)}</datalist>
          </LabeledField>

          {(provider.id === "minimax" || provider.id === "ollama" || provider.id === "custom" || baseUrl) && (
            <LabeledField label="Base URL" tip="The provider endpoint. Pre-filled for this provider; change it for a proxy or self-host.">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.baseUrl} />
            </LabeledField>
          )}

          {provider.needsKey && (
            <LabeledField label="API key" tip={`Stored locally in your CrewForge database. ${provider.keyHelp}`}>
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
          <p className="text-xs text-muted">{provider.keyHelp}</p>
        </div>
      </Card>
    </div>
  );
}
