import { useEffect, useState } from "react";
import { api, type LlmSettings } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField, Select } from "../components/ui";
import { useToast } from "../lib/toast";

// Providers present FRIENDLY model names; the LiteLLM wire string (e.g.
// "openai/MiniMax-M1") is what we store/send but is shown only as a small
// transparency note — never as the primary label.
type Model = { label: string; value: string };
type Provider = {
  id: string; label: string; models: Model[]; baseUrl: string;
  custom?: boolean; needsKey: boolean; keyHelp: string;
};

const PROVIDERS: Provider[] = [
  { id: "openai", label: "OpenAI", baseUrl: "", needsKey: true, keyHelp: "platform.openai.com → API keys",
    models: [{ label: "GPT-4o mini", value: "openai/gpt-4o-mini" }, { label: "GPT-4o", value: "openai/gpt-4o" }, { label: "o3-mini", value: "openai/o3-mini" }] },
  { id: "anthropic", label: "Anthropic", baseUrl: "", needsKey: true, keyHelp: "console.anthropic.com → API keys",
    models: [{ label: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet-latest" }, { label: "Claude 3.5 Haiku", value: "anthropic/claude-3-5-haiku-latest" }] },
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.io/v1", needsKey: true, keyHelp: "MiniMax platform → API key",
    models: [{ label: "MiniMax-M1", value: "openai/MiniMax-M1" }, { label: "MiniMax-Text-01", value: "openai/MiniMax-Text-01" }, { label: "abab6.5s-chat", value: "openai/abab6.5s-chat" }] },
  { id: "gemini", label: "Google Gemini", baseUrl: "", needsKey: true, keyHelp: "aistudio.google.com → API key",
    models: [{ label: "Gemini 1.5 Pro", value: "gemini/gemini-1.5-pro" }, { label: "Gemini 1.5 Flash", value: "gemini/gemini-1.5-flash" }] },
  { id: "groq", label: "Groq", baseUrl: "", needsKey: true, keyHelp: "console.groq.com → API keys",
    models: [{ label: "Llama 3.3 70B", value: "groq/llama-3.3-70b-versatile" }] },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434", needsKey: false, keyHelp: "No key needed — runs locally",
    models: [{ label: "Llama 3.1", value: "ollama/llama3.1" }, { label: "Qwen 2.5", value: "ollama/qwen2.5" }] },
  { id: "custom", label: "Custom", baseUrl: "https://your-endpoint/v1", custom: true, needsKey: true,
    keyHelp: "Any OpenAI-compatible endpoint (vLLM, LM Studio, a proxy…). Enter the full model id.",
    models: [] },
];

function providerForModel(value: string): Provider {
  return PROVIDERS.find((p) => p.models.some((m) => m.value === value))
    ?? PROVIDERS.find((p) => !p.custom && value.startsWith(p.id))
    ?? PROVIDERS.find((p) => p.custom)!;
}
function labelFor(p: Provider, value: string): string {
  return p.models.find((m) => m.value === value)?.label ?? value;
}

export function Settings() {
  const toast = useToast();
  const [cfg, setCfg] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [model, setModel] = useState(PROVIDERS[0].models[0].value); // wire string
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
        setProvider(p); setModel(c.model); setBaseUrl(c.base_url || p.baseUrl);
      }
      setTemperature(c.temperature == null ? "" : String(c.temperature));
    }).catch(() => {});
  }, []);

  function pickProvider(p: Provider) {
    setProvider(p);
    setModel(p.custom ? "" : p.models[0].value);
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
      toast(`Saved — ${provider.label} · ${labelFor(provider, model)}`, "ok");
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  const showBaseUrl = provider.custom || provider.id === "minimax" || provider.id === "ollama" || !!baseUrl;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Models</h1>
        <p className="text-sm text-muted">The LLM that powers your agents. Dry-run works with no key; live runs use this. Pick a provider → choose a model → add your key.</p>
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
          <LabeledField label="Model" tip="The model that runs your agents. Pick one for this provider.">
            {provider.custom ? (
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="openai/your-model" />
            ) : (
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {provider.models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            )}
            {model && (
              <p className="mt-1 text-[11px] text-muted">
                Sent to the API as <code className="rounded bg-elevated2 px-1 py-0.5 text-ink">{model}</code>
                {showBaseUrl && baseUrl ? <> · base <code className="rounded bg-elevated2 px-1 py-0.5 text-ink">{baseUrl}</code></> : null}
              </p>
            )}
          </LabeledField>

          {showBaseUrl && (
            <LabeledField label="Base URL" tip="The provider endpoint. Pre-filled for this provider; change it for a proxy or self-host.">
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
          <p className="text-xs text-muted">{provider.keyHelp}</p>
        </div>
      </Card>
    </div>
  );
}
