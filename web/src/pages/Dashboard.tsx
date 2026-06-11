import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api, type LlmSettings, type TemplateSummary, type WorkspaceSummary,
} from "../lib/api";
import { Button, Card, CardHeader, Input, Modal, Pill } from "../components/ui";
import { useToast } from "../lib/toast";
import { FileStack, Plus } from "lucide-react";

export function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [runCount, setRunCount] = useState<number | null>(null);
  const [spend, setSpend] = useState<number>(0);
  const [creating, setCreating] = useState(false);

  function load() {
    api.workspaces().then((d) => setWorkspaces(d.workspaces)).catch(() => {});
  }
  useEffect(() => {
    load();
    api.templates().then((d) => setTemplates(d.templates)).catch(() => {});
    api.getLlm().then(setLlm).catch(() => {});
    api.runs().then((d) => {
      setRunCount(d.runs.length);
      setSpend(d.runs.reduce((s, r) => s + (r.cost || 0), 0));
    }).catch(() => {});
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this workflow?")) return;
    await api.deleteWorkspace(id); toast("Deleted", "ok"); load();
  }
  async function duplicate(id: string) {
    try { const ws = await api.duplicateWorkspace(id); toast(`Duplicated as "${ws.name}"`, "ok"); load(); }
    catch (e) { toast(String(e), "error"); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Your workflows</h1>
          <p className="text-sm text-muted">Design, run, and observe CrewAI agent workflows — no code.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New workflow</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="workflows" value={String(workspaces.length)} tone="brand" />
        <Stat label="active model" value={llm?.configured ? (llm.model || "set") : "dry-run"} tone={llm?.configured ? "ok" : "muted"} />
        <Stat label="total runs" value={runCount == null ? "…" : String(runCount)} tone="ink" />
        <Stat label="est. spend" value={spend ? `$${spend.toFixed(spend < 0.1 ? 4 : 2)}` : "$0"} tone="ink" />
      </div>

      <Card>
        <CardHeader title="Workflows" sub="Open one to edit agents, tasks, and tools — then run it." />
        <div className="divide-y divide-border">
          {workspaces.map((w) => (
            <div key={w.id} className="group flex items-center justify-between gap-4 px-4 py-3">
              <button onClick={() => navigate(`/builder?ws=${w.id}`)} className="min-w-0 flex-1 text-left">
                <div className="font-medium text-ink">{w.name}</div>
                <div className="truncate text-xs text-muted">{w.description || "No description"}</div>
              </button>
              <div className="flex items-center gap-2">
                <Pill color="var(--color-node-agent)">{w.agents} agents</Pill>
                <Pill color="var(--color-node-task)">{w.tasks} tasks</Pill>
                <Button variant="ghost" onClick={() => navigate(`/builder?ws=${w.id}`)}>Open</Button>
                <button onClick={() => duplicate(w.id)} className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-ink" title="Duplicate">⧉</button>
                <button onClick={() => remove(w.id)} className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger" title="Delete">✕</button>
              </div>
            </div>
          ))}
          {!workspaces.length && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              No workflows yet. Click <span className="text-brand">+ New workflow</span> to start from a template or blank.
            </div>
          )}
        </div>
      </Card>

      {creating && <CreateModal templates={templates} onClose={() => setCreating(false)}
        onCreate={async (name, template) => {
          try { const ws = await api.createWorkspace(name, template); navigate(`/builder?ws=${ws.id}`); }
          catch (e) { toast(String(e), "error"); }
        }} />}
    </div>
  );
}

function CreateModal({ templates, onClose, onCreate }: {
  templates: TemplateSummary[]; onClose: () => void;
  onCreate: (name: string, template?: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal title="New workflow" onClose={onClose}>
      <div className="space-y-4">
        <Input autoFocus placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="text-xs font-medium text-muted">Start from a template</div>
        <div className="grid grid-cols-1 gap-2">
          {templates.map((t) => (
            <button key={t.id} onClick={() => onCreate(name || t.name, t.id)}
              className="flex items-start gap-3 rounded-lg border border-border bg-canvas p-3 text-left transition hover:border-brand">
              <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <div>
                <div className="text-sm font-medium text-ink">{t.name} <span className="text-xs text-muted">· {t.agents} agents · {t.tasks} tasks</span></div>
                <div className="text-xs text-muted">{t.description}</div>
              </div>
            </button>
          ))}
        </div>
        <button onClick={() => onCreate(name || "Untitled Crew")}
          className="w-full rounded-lg border border-dashed border-border p-3 text-sm text-muted transition hover:border-brand hover:text-ink">
          Start blank
        </button>
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "brand" | "ok" | "ink" | "muted" }) {
  const color = tone === "brand" ? "text-brand" : tone === "ok" ? "text-ok" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 truncate text-2xl font-semibold ${color}`}>{value}</div>
    </Card>
  );
}
