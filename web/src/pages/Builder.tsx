import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type Manifest, type Workspace } from "../lib/api";
import { Badge, Button, Card, CardHeader, Pill } from "../components/ui";
import { DynamicForm } from "../components/DynamicForm";

export function Builder() {
  const [params] = useSearchParams();
  const wsId = params.get("ws") ?? "demo-research-crew";
  const navigate = useNavigate();

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [selected, setSelected] = useState(0);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.manifest().then(setManifest).catch(() => {});
    api.workspace(wsId).then((w) => { setWs(w); setSelected(0); }).catch(() => {});
  }, [wsId]);

  const agent = ws?.agents[selected];
  const initial = useMemo(
    () => (agent ? { role: agent.role, goal: agent.goal, backstory: agent.backstory } : {}),
    [agent],
  );

  async function run() {
    setStarting(true);
    try {
      const { run_id } = await api.startRun(wsId);
      navigate(`/runs?run=${run_id}`);
    } finally {
      setStarting(false);
    }
  }

  if (!ws || !manifest) return <div className="text-sm text-muted">Loading builder…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{ws.name}</h1>
          <p className="text-sm text-muted">{ws.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="var(--color-node-crew)">process: {ws.process}</Pill>
          <Button onClick={run} disabled={starting}>▶ {starting ? "Starting…" : "Run (dry-run)"}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Agents" />
            <div className="divide-y divide-border">
              {ws.agents.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => setSelected(i)}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition ${
                    i === selected ? "bg-brand-soft" : "hover:bg-elevated2"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-node-agent)" }} />
                  <span className="text-ink">{a.role}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Tasks" />
            <div className="divide-y divide-border">
              {ws.tasks.map((t, i) => (
                <div key={i} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-node-task)" }} />
                    <span className="text-ink">{t.agent}</span>
                    {t.human_input && <Badge tone="warn">HITL gate</Badge>}
                  </div>
                  <div className="mt-0.5 pl-4 text-xs text-muted">{t.description}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title={`Agent: ${agent?.role}`}
            sub={`Form generated from crewai ${manifest.crewai_version} — ${manifest.counts.Agent} Agent fields, none hardcoded.`}
            right={<Badge tone="ok">manifest-driven</Badge>}
          />
          <div className="p-5">
            <DynamicForm fields={manifest.models.Agent} initial={initial} key={agent?.id} />
          </div>
        </Card>
      </div>
    </div>
  );
}
