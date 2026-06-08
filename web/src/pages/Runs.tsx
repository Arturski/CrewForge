import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type RunEvent, type RunRecord, type Workspace } from "../lib/api";
import { Badge, Button, Card, CardHeader } from "../components/ui";
import { EventTimeline } from "../components/EventTimeline";
import { CrewCanvas, type NodeStatus } from "../components/CrewCanvas";

const STATUS_TONE = { running: "running", succeeded: "ok", failed: "danger" } as const;

export function Runs() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [recent, setRecent] = useState<RunRecord[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const esRef = useRef<EventSource | null>(null);

  function refreshRecent() {
    api.runs().then((d) => setRecent(d.runs)).catch(() => {});
  }
  useEffect(refreshRecent, [runId]);

  // Live SSE subscription for the selected run.
  useEffect(() => {
    esRef.current?.close();
    setEvents([]); setRecord(null); setWorkspace(null);
    if (!runId) return;

    const es = new EventSource(`/api/runs/${runId}/events/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      const evt = JSON.parse(e.data) as RunEvent;
      setEvents((prev) => (prev.some((p) => p.seq === evt.seq) ? prev : [...prev, evt]));
    };
    es.addEventListener("end", () => {
      es.close();
      api.run(runId).then(setRecord).then(refreshRecent).catch(() => {});
    });
    es.onerror = () => es.close();
    api.run(runId).then(setRecord).catch(() => {});
    return () => es.close();
  }, [runId]);

  // Load the workflow graph for this run so the canvas can light up.
  useEffect(() => {
    if (record?.workspace_id) api.workspace(record.workspace_id).then(setWorkspace).catch(() => {});
  }, [record?.workspace_id]);

  // Derive per-node run status from the event stream.
  const status = useMemo(() => {
    if (!workspace) return {};
    const roleToId: Record<string, string> = {};
    workspace.agents.forEach((a) => { roleToId[a.role] = a.id; });
    const map: Record<string, NodeStatus> = {};
    for (const e of events) {
      const aid = e.agent ? roleToId[e.agent] : undefined;
      if (e.kind === "agent.execution.started" && aid) map[`agent:${aid}`] = "running";
      else if (e.kind === "agent.execution.completed" && aid) map[`agent:${aid}`] = "done";
      else if (e.kind === "agent.error" && aid) map[`agent:${aid}`] = "error";
      else if (e.kind === "task.started" && e.task_index != null) map[`task:${e.task_index}`] = "running";
      else if (e.kind === "task.completed" && e.task_index != null) map[`task:${e.task_index}`] = "done";
    }
    return map;
  }, [events, workspace]);

  async function startDemo() {
    try {
      const { workspaces } = await api.workspaces();
      if (!workspaces.length) return;
      const { run_id } = await api.startRun(workspaces[0].id);
      setParams({ run: run_id });
    } catch { /* noop */ }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Runs</h1>
          <p className="text-sm text-muted">Watch the workflow execute live, step by step.</p>
        </div>
        <Button onClick={startDemo}>▶ Run a workflow</Button>
      </div>

      {workspace && (
        <Card className="overflow-hidden">
          <CrewCanvas ws={workspace} readOnly status={status} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader
            title={runId ? record?.spec_name ?? `Run ${runId}` : "Live event timeline"}
            sub={runId ? `run ${runId}` : undefined}
            right={
              record && (
                <span className="flex items-center gap-2">
                  {record.tokens ? <Badge tone="running">{record.tokens} tokens</Badge> : null}
                  <Badge tone={STATUS_TONE[record.status]}>
                    {record.status}{record.dry_run ? " · dry-run" : ""}
                  </Badge>
                </span>
              )
            }
          />
          <EventTimeline events={events} />
          {record?.result && (
            <div className="border-t border-border p-4">
              <div className="mb-1 text-xs text-muted">final output</div>
              <pre className="whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs text-ink">{record.result}</pre>
            </div>
          )}
          {record?.error && (
            <div className="border-t border-border p-4 text-xs text-danger">{record.error}</div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent runs" />
          <div className="divide-y divide-border">
            {recent.map((r) => (
              <button
                key={r.id}
                onClick={() => setParams({ run: r.id })}
                className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-elevated2 ${
                  r.id === runId ? "bg-brand-soft" : ""
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="text-ink">{r.spec_name}</span>{" "}
                  <span className="font-mono text-[10px] text-muted">{r.id.slice(0, 6)}</span>
                </span>
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
              </button>
            ))}
            {recent.length === 0 && <div className="px-4 py-6 text-sm text-muted">No runs yet.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
