import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Code2, Download, Play, Plus, Trash2 } from "lucide-react";
import {
  api, type AgentSpec, type LlmSettings, type Manifest, type Persona, type TaskSpec, type ToolInfo, type Workspace,
} from "../lib/api";
import {
  Badge, Button, Card, CardHeader, Input, LabeledField, Modal, Select, Textarea, Toggle, Tooltip,
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
  const [llm, setLlm] = useState<LlmSettings | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaOpen, setPersonaOpen] = useState(false);

  useEffect(() => {
    api.manifest().then(setManifest).catch(() => {});
    api.tools().then((d) => setTools(d.tools)).catch(() => {});
    api.getLlm().then((c) => { setLlm(c); setDryRun(!c.configured); }).catch(() => {});
    api.personas().then((d) => setPersonas(d.personas)).catch(() => {});
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
  async function doRun(inputs: Record<string, string>) {
    if (!ws) return;
    if (dirty) await save();
    try {
      const { run_id } = await api.startRun(ws.id, dryRun, inputs);
      navigate(`/runs?run=${run_id}`);
    } catch (e) { toast(String(e), "error"); }
  }
  function onRun() {
    if (ws?.inputs?.length) setInputsOpen(true);
    else doRun({});
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
          <Link to="/models" title="Configure the model">
            <Badge tone={dryRun ? "warn" : "ok"}>{dryRun ? "dry-run" : (llm?.model ? llm.model.split("/").pop() : "no model")}</Badge>
          </Link>
          <div className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1">
            <span className="text-xs text-muted">Dry run</span>
            <Toggle checked={dryRun} onChange={setDryRun} />
          </div>
          <Button variant="ghost" size="icon" onClick={() => window.open(api.exportUrl(ws.id), "_blank")} title="Export project"><Download className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(`/code?ws=${ws.id}`)} title="View code"><Code2 className="h-4 w-4" /></Button>
          <Button variant="ghost" onClick={save} disabled={busy || !dirty}>Save</Button>
          <Button onClick={onRun}><Play className="h-4 w-4" /> Run</Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CrewCanvas
          ws={ws}
          sel={sel}
          onSelect={setSel}
          onAddAgent={addAgent}
          onAddTask={addTask}
          onDelete={(s) => {
            if (!s) return;
            if (s.kind === "agent") mutate((w) => { w.agents.splice(s.idx, 1); });
            else mutate((w) => { w.tasks.splice(s.idx, 1); });
            setSel(null);
          }}
          onMove={(nodeId, x, y) => mutate((w) => { w.layout = { ...(w.layout ?? {}), [nodeId]: { x, y } }; })}
        />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        {/* lists */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Workflow tools" sub="Tools shared by every agent in this crew." />
            <div className="p-4">
              <SkillPicker all={tools} value={ws.skills ?? []} onChange={(v) => mutate((w) => { w.skills = v; })} />
              <p className="mt-2 text-xs text-muted">Get more in <Link to="/tools?tab=integrations" className="text-brand hover:underline">Tools → Integrations</Link>.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Workflow settings" />
            <div className="space-y-3 p-4">
              <InlineToggle label="Planning" tip="The crew plans the whole workflow before executing — improves multi-step quality."
                checked={!!ws.planning} onChange={(v) => mutate((w) => { w.planning = v; })} />
              <InlineToggle label="Memory" tip="Agents remember context across steps and past runs. Live runs only (needs a provider for embeddings)."
                checked={!!ws.memory} onChange={(v) => mutate((w) => { w.memory = v; })} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Run inputs" sub="Variables you fill in at run time. Reference as {name} in tasks." />
            <div className="space-y-2 p-4">
              {(ws.inputs ?? []).map((inp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="topic" value={inp.name}
                    onChange={(e) => mutate((w) => { w.inputs![i] = { ...w.inputs![i], name: e.target.value }; })} />
                  <button onClick={() => mutate((w) => { w.inputs!.splice(i, 1); })}
                    className="text-muted hover:text-danger" aria-label="Remove input"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button onClick={() => mutate((w) => { w.inputs = [...(w.inputs ?? []), { name: "" }]; })}
                className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><Plus className="h-3 w-3" /> Add input</button>
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
                sub="Describe the agent in plain language. Hover any ? for help."
                right={<Button variant="ghost" size="sm" onClick={() => setPersonaOpen(true)}>✨ Start from persona</Button>} />
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
                <LabeledField label="Model (optional)" tip="Override the workflow's default model for just this agent (uses your configured provider key). Blank = use the default.">
                  <Input placeholder={`default: ${llm?.model || "dry-run"}`} value={(agent.llm_model as string) ?? ""}
                    onChange={(e) => mutate((w) => { w.agents[sel!.idx].llm_model = e.target.value; })} />
                </LabeledField>
                <LabeledField label="Agent tools" tip="Tools only this agent can use, on top of any workflow-wide tools. Tools from integrations run live; built-in tools are also exported.">
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
                <InlineToggle label="Run in parallel" tip="Run this task asynchronously alongside others (advanced)."
                  checked={!!(task as Record<string, unknown>).async_execution}
                  onChange={(v) => mutate((w) => { (w.tasks[sel!.idx] as Record<string, unknown>).async_execution = v; })} />
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                    Structured output<Tooltip text="Force the result into named JSON fields — great for piping into the next step or an app. Used on live runs." />
                  </div>
                  {(((task.output_schema as { name: string; type: string }[]) ?? [])).map((f, fi) => (
                    <div key={fi} className="mb-2 flex items-center gap-2">
                      <Input className="flex-1" placeholder="field name" value={f.name}
                        onChange={(e) => mutate((w) => { (w.tasks[sel!.idx].output_schema as { name: string; type: string }[])[fi] = { ...f, name: e.target.value }; })} />
                      <Select className="w-28" value={f.type}
                        onChange={(e) => mutate((w) => { (w.tasks[sel!.idx].output_schema as { name: string; type: string }[])[fi] = { ...f, type: e.target.value }; })}>
                        {["string", "integer", "number", "boolean", "list"].map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <button onClick={() => mutate((w) => { (w.tasks[sel!.idx].output_schema as unknown[]).splice(fi, 1); })}
                        className="text-muted hover:text-danger" aria-label="Remove field"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => mutate((w) => { const t = w.tasks[sel!.idx] as Record<string, unknown>; t.output_schema = [...((t.output_schema as unknown[]) ?? []), { name: "", type: "string" }]; })}
                    className="inline-flex items-center gap-1 text-sm text-brand hover:underline"><Plus className="h-3 w-3" /> Add field</button>
                </div>
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
      {inputsOpen && ws.inputs && ws.inputs.length > 0 && (
        <InputsDialog inputs={ws.inputs} onClose={() => setInputsOpen(false)}
          onSubmit={(vals) => { setInputsOpen(false); doRun(vals); }} />
      )}
      {personaOpen && sel?.kind === "agent" && (
        <PersonaModal personas={personas} onClose={() => setPersonaOpen(false)}
          onPick={(p) => {
            mutate((w) => {
              const a = w.agents[sel.idx];
              a.role = p.role; a.goal = p.goal; a.backstory = p.backstory;
              a.tools = Array.from(new Set([...(a.tools ?? []), ...p.suggested_tools]));
            });
            setPersonaOpen(false);
          }} />
      )}
    </div>
  );
}

function InputsDialog({ inputs, onClose, onSubmit }: {
  inputs: { name: string; description?: string; default?: string }[];
  onClose: () => void; onSubmit: (vals: Record<string, string>) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(inputs.filter((i) => i.name).map((i) => [i.name, i.default ?? ""])),
  );
  return (
    <Modal title="Run inputs" onClose={onClose}>
      <div className="space-y-4">
        {inputs.filter((i) => i.name).map((i) => (
          <LabeledField key={i.name} label={i.name} tip={i.description}>
            <Input value={vals[i.name] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [i.name]: e.target.value }))} />
          </LabeledField>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(vals)}><Play className="h-4 w-4" /> Run</Button>
        </div>
      </div>
    </Modal>
  );
}

function PersonaModal({ personas, onClose, onPick }: {
  personas: Persona[]; onClose: () => void; onPick: (p: Persona) => void;
}) {
  return (
    <Modal title="Start from a persona" onClose={onClose}>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        <p className="text-xs text-muted">Pick a detailed, ready-made persona — it fills this agent's role, goal, backstory, and suggested tools.</p>
        {personas.map((p) => (
          <button key={p.id} onClick={() => onPick(p)}
            className="block w-full rounded-lg border border-border bg-canvas p-3 text-left transition hover:border-brand">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{p.name}</span>
              {p.tags.map((t) => <Badge key={t} tone="muted">{t}</Badge>)}
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-muted">{p.backstory}</div>
          </button>
        ))}
      </div>
    </Modal>
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
        {!value.length && <span className="text-xs text-muted">No tools attached.</span>}
      </div>
      <Input placeholder={all.length ? "Search tools to add…" : "No tools available"} value={q}
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
