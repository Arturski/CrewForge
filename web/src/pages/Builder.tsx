import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  api, type AgentSpec, type Manifest, type TaskSpec, type ToolInfo, type Workspace,
} from "../lib/api";
import {
  Badge, Button, Card, CardHeader, Input, LabeledField, Select, Textarea, Toggle, Tooltip,
} from "../components/ui";
import { DynamicForm } from "../components/DynamicForm";
import { CrewCanvas } from "../components/CrewCanvas";
import { useToast } from "../lib/toast";

type Sel = { kind: "agent" | "task"; idx: number } | null;
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 7)}`;

export function Builder() {
  const [params] = useSearchParams();
  const wsId = params.get("ws");
  const navigate = useNavigate();
  const toast = useToast();

  const [ws, setWs] = useState<Workspace | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.manifest().then(setManifest).catch(() => {});
    api.tools().then((d) => setTools(d.tools)).catch(() => {});
  }, []);
  // No dead-end: if no workspace in the URL, open the last-used (or first) one.
  useEffect(() => {
    if (wsId) return;
    const go = (id: string) => navigate(`/builder?ws=${id}`, { replace: true });
    (async () => {
      const last = localStorage.getItem("cf:lastWs");
      if (last) { try { await api.workspace(last); return go(last); } catch { /* stale */ } }
      try { const { workspaces } = await api.workspaces(); if (workspaces[0]) go(workspaces[0].id); } catch { /* none */ }
    })();
  }, [wsId, navigate]);

  useEffect(() => {
    if (!wsId) return;
    api.workspace(wsId).then((w) => {
      setWs(w);
      setSel(w.agents.length ? { kind: "agent", idx: 0 } : null);
      localStorage.setItem("cf:lastWs", w.id);
    }).catch(() => toast("Workspace not found", "error"));
  }, [wsId]);

  function mutate(fn: (w: Workspace) => void) {
    setWs((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }

  function addAgent() {
    const a: AgentSpec = { id: newId("agent"), role: "New Agent", goal: "", backstory: "" };
    mutate((w) => w.agents.push(a));
    setWs((w) => { if (w) setSel({ kind: "agent", idx: w.agents.length - 1 }); return w; });
  }
  function addTask() {
    if (!ws?.agents.length) return toast("Add an agent first", "error");
    const t: TaskSpec = { agent: ws.agents[0].id, description: "", expected_output: "" };
    mutate((w) => w.tasks.push(t));
    setWs((w) => { if (w) setSel({ kind: "task", idx: w.tasks.length - 1 }); return w; });
  }

  async function save() {
    if (!ws) return;
    setBusy(true);
    try { await api.saveWorkspace(ws); setDirty(false); toast("Saved", "ok"); }
    catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }
  async function run(dry: boolean) {
    if (!ws) return;
    if (dirty) await save();
    try {
      const { run_id } = await api.startRun(ws.id, dry);
      navigate(`/runs?run=${run_id}`);
    } catch (e) { toast(String(e), "error"); }
  }

  if (!wsId) return <Empty />;
  if (!ws || !manifest) return <div className="text-sm text-muted">Loading…</div>;

  const agent = sel?.kind === "agent" ? ws.agents[sel.idx] : null;
  const task = sel?.kind === "task" ? ws.tasks[sel.idx] : null;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <input
            className="w-full truncate bg-transparent text-xl font-semibold text-ink outline-none"
            value={ws.name}
            onChange={(e) => mutate((w) => { w.name = e.target.value; })}
          />
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span>process</span>
            <Select className="w-auto py-0.5" value={ws.process}
              onChange={(e) => mutate((w) => { w.process = e.target.value; })}>
              <option value="sequential">sequential</option>
              <option value="hierarchical">hierarchical</option>
            </Select>
            {dirty && <Badge tone="warn">unsaved</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => window.open(api.exportUrl(ws.id), "_blank")}>⬇ Export</Button>
          <Button variant="ghost" onClick={() => navigate(`/code?ws=${ws.id}`)}>{"</>"} Code</Button>
          <Button variant="ghost" onClick={save} disabled={busy || !dirty}>Save</Button>
          <Button variant="ghost" onClick={() => run(false)}>▶ Run live</Button>
          <Button onClick={() => run(true)}>▶ Run (dry)</Button>
        </div>
      </div>

      <Card className="overflow-hidden"><CrewCanvas ws={ws} activeAgent={agent?.role} /></Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* lists */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Workflow skills" sub="Shared by every agent in this crew." />
            <div className="p-4">
              <SkillPicker all={tools} value={ws.skills ?? []} onChange={(v) => mutate((w) => { w.skills = v; })} />
              <p className="mt-2 text-xs text-muted">Add more under <Link to="/mcp" className="text-brand hover:underline">MCP</Link>.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Agents" right={<button onClick={addAgent} className="text-sm text-brand hover:underline">+ Add</button>} />
            <div className="divide-y divide-border">
              {ws.agents.map((a, i) => (
                <Row key={a.id} active={sel?.kind === "agent" && sel.idx === i}
                  dot="var(--color-node-agent)" label={a.role || "Untitled agent"}
                  onClick={() => setSel({ kind: "agent", idx: i })}
                  onDelete={() => { mutate((w) => w.agents.splice(i, 1)); setSel(null); }} />
              ))}
              {!ws.agents.length && <P>No agents yet.</P>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Tasks" right={<button onClick={addTask} className="text-sm text-brand hover:underline">+ Add</button>} />
            <div className="divide-y divide-border">
              {ws.tasks.map((t, i) => (
                <Row key={i} active={sel?.kind === "task" && sel.idx === i}
                  dot="var(--color-node-task)" label={t.name || t.description.slice(0, 28) || "Untitled task"}
                  badge={t.human_input ? "HITL" : undefined}
                  onClick={() => setSel({ kind: "task", idx: i })}
                  onDelete={() => { mutate((w) => w.tasks.splice(i, 1)); setSel(null); }} />
              ))}
              {!ws.tasks.length && <P>No tasks yet.</P>}
            </div>
          </Card>
        </div>

        {/* inspector */}
        <Card>
          {agent && (
            <>
              <CardHeader title={`Agent: ${agent.role || "Untitled"}`}
                sub="Describe the agent in plain language. Hover any ? for help." />
              <div className="space-y-4 p-5">
                <LabeledField label="Role" tip="A short title for what this agent is, e.g. 'Senior Researcher'. Shapes how it behaves.">
                  <Input value={agent.role} onChange={(e) => mutate((w) => { (w.agents[sel!.idx]).role = e.target.value; })} />
                </LabeledField>
                <LabeledField label="Goal" tip="The single objective this agent works toward. Be specific.">
                  <Textarea value={agent.goal} onChange={(e) => mutate((w) => { w.agents[sel!.idx].goal = e.target.value; })} />
                </LabeledField>
                <LabeledField label="Backstory" tip="Context and expertise that guides the agent's decisions and tone.">
                  <Textarea value={agent.backstory} onChange={(e) => mutate((w) => { w.agents[sel!.idx].backstory = e.target.value; })} />
                </LabeledField>
                <div className="flex flex-wrap gap-6">
                  <InlineToggle label="Allow delegation" tip="Let this agent hand subtasks to other agents in the crew."
                    checked={!!agent.allow_delegation} onChange={(v) => mutate((w) => { w.agents[sel!.idx].allow_delegation = v; })} />
                  <InlineToggle label="Reasoning" tip="Have the agent plan and reflect before acting. Higher quality, a bit slower."
                    checked={!!(agent as Record<string, unknown>).reasoning} onChange={(v) => mutate((w) => { (w.agents[sel!.idx] as Record<string, unknown>).reasoning = v; })} />
                </div>
                <LabeledField label="Skills (this agent)" tip="Capabilities only this agent can use, on top of any workflow-wide skills. Add more under MCP. MCP skills run live; built-in tools are also exported.">
                  <SkillPicker all={tools} value={agent.tools ?? []} onChange={(v) => mutate((w) => { w.agents[sel!.idx].tools = v; })} />
                </LabeledField>

                <div>
                  <button onClick={() => setShowAdvanced((s) => !s)} className="text-sm text-brand hover:underline">
                    {showAdvanced ? "Hide" : "Show"} advanced settings (full crewai {manifest.crewai_version} schema)
                  </button>
                  {showAdvanced && (
                    <div className="mt-4 rounded-lg border border-border bg-canvas p-4">
                      <DynamicForm fields={manifest.models.Agent}
                        values={agent as unknown as Record<string, unknown>}
                        hideNames={["role", "goal", "backstory", "tools", "allow_delegation"]}
                        onChange={(name, value) => mutate((w) => { (w.agents[sel!.idx] as Record<string, unknown>)[name] = value; })} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {task && (
            <>
              <CardHeader title="Task" sub="Define one step of the workflow." />
              <div className="space-y-4 p-5">
                <LabeledField label="Name" tip="A short identifier for this step.">
                  <Input value={task.name ?? ""} onChange={(e) => mutate((w) => { w.tasks[sel!.idx].name = e.target.value; })} />
                </LabeledField>
                <LabeledField label="Assigned agent" tip="Which agent performs this task.">
                  <Select value={task.agent} onChange={(e) => mutate((w) => { w.tasks[sel!.idx].agent = e.target.value; })}>
                    {ws.agents.map((a) => <option key={a.id} value={a.id}>{a.role}</option>)}
                  </Select>
                </LabeledField>
                <LabeledField label="Description" tip="Exactly what to do in this step.">
                  <Textarea value={task.description} onChange={(e) => mutate((w) => { w.tasks[sel!.idx].description = e.target.value; })} />
                </LabeledField>
                <LabeledField label="Expected output" tip="What a great result looks like. The agent is graded against this.">
                  <Textarea value={task.expected_output} onChange={(e) => mutate((w) => { w.tasks[sel!.idx].expected_output = e.target.value; })} />
                </LabeledField>
                <LabeledField label="Strict rules" tip="Hard constraints the agent MUST follow (one per line). Enforced as step-by-step reasoning rules for higher-quality, reliable output.">
                  <Textarea placeholder={"e.g.\n- Cite a source for every claim\n- Never invent figures"} value={(task as Record<string, unknown>).rules as string ?? ""} onChange={(e) => mutate((w) => { (w.tasks[sel!.idx] as Record<string, unknown>).rules = e.target.value; })} />
                </LabeledField>
                <InlineToggle label="Require human approval" tip="Pause for your review before the result passes to the next step."
                  checked={!!task.human_input} onChange={(v) => mutate((w) => { w.tasks[sel!.idx].human_input = v; })} />
              </div>
            </>
          )}

          {!agent && !task && (
            <div className="grid h-[300px] place-items-center text-sm text-muted">
              Select an agent or task, or click <span className="mx-1 text-brand">+ Add</span> to start.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Empty() {
  const navigate = useNavigate();
  const toast = useToast();
  async function create() {
    try { const ws = await api.createWorkspace("Untitled Crew"); navigate(`/builder?ws=${ws.id}`); }
    catch (e) { toast(String(e), "error"); }
  }
  return (
    <div className="grid h-[60vh] place-items-center text-center">
      <div>
        <div className="text-lg font-semibold text-ink">No workflows yet</div>
        <p className="mt-1 text-sm text-muted">Create your first workflow to start building.</p>
        <div className="mt-4"><Button onClick={create}>+ New workflow</Button></div>
      </div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-5 text-sm text-muted">{children}</div>;
}

function Row({ active, dot, label, badge, onClick, onDelete }: {
  active: boolean; dot: string; label: string; badge?: string;
  onClick: () => void; onDelete: () => void;
}) {
  return (
    <div className={`group flex items-center gap-2 px-4 py-2.5 text-sm transition ${active ? "bg-brand-soft" : "hover:bg-elevated2"}`}>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="truncate text-ink">{label}</span>
        {badge && <Badge tone="warn">{badge}</Badge>}
      </button>
      <button onClick={onDelete} className="opacity-0 transition group-hover:opacity-100 text-muted hover:text-danger" title="Delete">✕</button>
    </div>
  );
}

function InlineToggle({ label, tip, checked, onChange }: { label: string; tip: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Toggle checked={checked} onChange={onChange} />
      <span className="flex items-center gap-1.5 text-sm text-ink">{label}<Tooltip text={tip} /></span>
    </div>
  );
}

function SkillPicker({ all, value, onChange }: { all: ToolInfo[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = q ? all.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-md border border-border bg-elevated2 px-2 py-0.5 text-xs text-ink">
            {s}<button onClick={() => onChange(value.filter((x) => x !== s))} className="text-muted hover:text-danger">✕</button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-muted">No skills attached.</span>}
      </div>
      <Input placeholder={all.length ? "Search skills to add…" : "No skill catalog available"} value={q}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && matches.length > 0 && (
        <div className="mt-1 rounded-lg border border-border bg-elevated2">
          {matches.map((t) => (
            <button key={`${t.kind}:${t.server ?? ""}:${t.name}`} onClick={() => { if (!value.includes(t.name)) onChange([...value, t.name]); setQ(""); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-canvas">
              <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${t.kind === "mcp" ? "bg-brand/15 text-brand" : "bg-ok/15 text-ok"}`}>{t.kind === "mcp" ? "MCP" : "built-in"}</span>
              <span className="truncate text-ink">{t.name}</span>
              <span className="truncate text-muted">{t.description.slice(0, 40)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
