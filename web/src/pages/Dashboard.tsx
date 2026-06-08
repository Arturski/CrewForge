import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Manifest, type WorkspaceSummary } from "../lib/api";
import { Button, Card, CardHeader, Input, Modal, Pill } from "../components/ui";
import { useToast } from "../lib/toast";

export function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function load() {
    api.workspaces().then((d) => setWorkspaces(d.workspaces)).catch(() => {});
  }
  useEffect(() => {
    api.manifest().then(setManifest).catch(() => {});
    load();
  }, []);

  async function create() {
    try {
      const ws = await api.createWorkspace(name || "Untitled Crew");
      setCreating(false); setName("");
      navigate(`/builder?ws=${ws.id}`);
    } catch (e) { toast(String(e), "error"); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this workflow?")) return;
    await api.deleteWorkspace(id);
    toast("Deleted", "ok");
    load();
  }

  const total = manifest ? Object.values(manifest.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Your workflows</h1>
          <p className="text-sm text-muted">Design, run, and observe CrewAI agent workflows — no code.</p>
        </div>
        <Button onClick={() => setCreating(true)}>+ New workflow</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="workflows" value={String(workspaces.length)} tone="brand" />
        <Stat label="crewai" value={manifest?.crewai_version ?? "…"} tone="ink" />
        <Stat label="fields auto-mapped" value={total ? String(total) : "…"} tone="ok" />
        <Stat label="hardcoded fields" value="0" tone="ok" />
      </div>

      <Card>
        <CardHeader title="Workflows" sub="Open one to edit agents, tasks, and rules — then run it." />
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
                <button onClick={() => remove(w.id)} className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-danger" title="Delete">✕</button>
              </div>
            </div>
          ))}
          {!workspaces.length && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              No workflows yet. Click <span className="text-brand">+ New workflow</span> to start.
            </div>
          )}
        </div>
      </Card>

      {creating && (
        <Modal title="New workflow" onClose={() => setCreating(false)}>
          <div className="space-y-4">
            <Input autoFocus placeholder="e.g. Research & Summarize" value={name}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={create}>Create</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "brand" | "ok" | "ink" }) {
  const color = tone === "brand" ? "text-brand" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </Card>
  );
}
