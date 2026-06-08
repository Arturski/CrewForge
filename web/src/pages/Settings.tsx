import { useEffect, useState } from "react";
import { api, type LlmSettings } from "../lib/api";
import { Badge, Button, Card, CardHeader, Input, LabeledField, Select } from "../components/ui";
import { useToast } from "../lib/toast";

// Common LiteLLM-style model strings (CrewAI routes provider/model via LiteLLM).
const PRESETS = [
  { group: "OpenAI", models: ["openai/gpt-4o", "openai/gpt-4o-mini", "openai/o3-mini"] },
  { group: "Anthropic", models: ["anthropic/claude-3-5-sonnet-latest", "anthropic/claude-3-5-haiku-latest"] },
  { group: "Google", models: ["gemini/gemini-1.5-pro", "gemini/gemini-1.5-flash"] },
  { group: "Groq", models: ["groq/llama-3.3-70b-versatile"] },
  { group: "Local (Ollama)", models: ["ollama/llama3.1", "ollama/qwen2.5"] },
];

export function Settings() {
  const toast = useToast();
  const [cfg, setCfg] = useState<LlmSettings | null>(null);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getLlm().then((c) => {
      setCfg(c); setModel(c.model); setBaseUrl(c.base_url);
      setTemperature(c.temperature == null ? "" : String(c.temperature));
    }).catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.saveLlm({
        model, base_url: baseUrl,
        temperature: temperature === "" ? undefined : Number(temperature),
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      setApiKey("");
      const c = await api.getLlm(); setCfg(c);
      toast("Models settings saved", "ok");
    } catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Models</h1>
        <p className="text-sm text-muted">The LLM that powers your agents. Dry-run mode works with no key; live runs use this.</p>
      </div>

      <Card>
        <CardHeader title="Default provider & model"
          right={cfg?.configured ? <Badge tone="ok">configured</Badge> : <Badge tone="warn">not set · dry-run only</Badge>} />
        <div className="space-y-4 p-5">
          <LabeledField label="Model" tip="A LiteLLM-style id: provider/model. CrewAI routes to the right provider automatically.">
            <Input list="model-presets" placeholder="openai/gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
            <datalist id="model-presets">
              {PRESETS.flatMap((g) => g.models).map((m) => <option key={m} value={m} />)}
            </datalist>
          </LabeledField>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((g) => (
              <Select key={g.group} className="w-auto" value="" onChange={(e) => e.target.value && setModel(e.target.value)}>
                <option value="">{g.group}…</option>
                {g.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            ))}
          </div>
          <LabeledField label="API key" tip="Stored locally in your CrewForge database (single-user). Leave blank to keep the existing key.">
            <Input type="password" placeholder={cfg?.api_key_set ? "•••••••• (set — leave blank to keep)" : "sk-…"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </LabeledField>
          <div className="grid grid-cols-2 gap-4">
            <LabeledField label="Base URL (optional)" tip="Override the provider endpoint, e.g. a local Ollama or a proxy.">
              <Input placeholder="http://localhost:11434" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </LabeledField>
            <LabeledField label="Temperature (optional)" tip="0 = focused/deterministic, 1 = creative.">
              <Input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
            </LabeledField>
          </div>
          <Button onClick={save} disabled={busy || !model}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
