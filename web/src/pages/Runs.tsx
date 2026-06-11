import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type RunEvent, type RunRecord, type Workspace } from "../lib/api";
import { Badge, Button, Card, CardHeader, Textarea } from "../components/ui";
import { EventTimeline } from "../components/EventTimeline";
import { CrewCanvas, type NodeStatus } from "../components/CrewCanvas";
import { useToast } from "../lib/toast";

const STATUS_TONE = { running: "running", succeeded: "ok", failed: "danger", cancelled: "warn" } as const;

export function Runs() {
  const toast = useToast();
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
      // A gate opened or closed — refresh the record so the HITL panel follows.
      if (evt.kind.startsWith("hitl.")) api.run(runId).then(setRecord).catch(() => {});
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
      else if (e.kind === "task.skipped" && e.task_index != null) map[`task:${e.task_index}`] = "skipped";
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
                  {record.cost ? <Badge tone="warn">${record.cost.toFixed(record.cost < 0.1 ? 4 : 2)} est.</Badge> : null}
                  {record.trigger && record.trigger !== "manual" ? <Badge tone="brand">{record.trigger.split(":")[0]}</Badge> : null}
                  <Badge tone={STATUS_TONE[record.status]}>
                    {record.status}{record.dry_run ? " · dry-run" : ""}
                  </Badge>
                  {record.status === "running" && (
                    <Button variant="ghost" onClick={async () => {
                      try { await api.cancelRun(record.id); toast("Stopping run…", "ok"); }
                      catch (e) { toast(String(e), "error"); }
                    }}>■ Stop</Button>
                  )}
                  {record.status !== "running" && record.workspace_id && (
                    <Button variant="ghost" onClick={async () => {
                      try {
                        const { run_id } = await api.startRun(record.workspace_id!, record.dry_run, record.inputs ?? {});
                        setParams({ run: run_id });
                      } catch (e) { toast(String(e), "error"); }
                    }}>↻ Replay</Button>
                  )}
                </span>
              )
            }
          />
          {record?.hitl && record.status === "running" && (
            <HitlPanel runId={record.id} output={record.hitl.output}
              onDecided={() => api.run(record.id).then(setRecord).catch(() => {})} />
          )}
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

// Shown while the run is blocked at a human-approval gate. Approve passes the
// output on; editing replaces it; requesting changes sends the agent back with
// feedback for another attempt.
function HitlPanel({ runId, output, onDecided }: {
  runId: string; output: string; onDecided: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"review" | "edit" | "reject">("review");
  const [edit, setEdit] = useState(output);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(body: { decision: "approve" | "reject"; edit?: string; feedback?: string }) {
    setBusy(true);
    try { await api.hitlDecision(runId, body); onDecided(); }
    catch (e) { toast(String(e), "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="border-t border-warn/40 bg-warn/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="warn">human input required</Badge>
        <span className="text-xs text-muted">The workflow is paused until you decide.</span>
      </div>
      {mode === "review" && (
        <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs text-ink">{output}</pre>
      )}
      {mode === "edit" && (
        <Textarea className="mb-3 min-h-32 text-xs" value={edit} onChange={(e) => setEdit(e.target.value)} />
      )}
      {mode === "reject" && (
        <Textarea className="mb-3 text-xs" placeholder="What should the agent change? This feedback goes back to it for another attempt."
          value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {mode === "review" && (
          <>
            <Button onClick={() => send({ decision: "approve" })} disabled={busy}>✓ Approve</Button>
            <Button variant="ghost" onClick={() => setMode("edit")} disabled={busy}>Edit output</Button>
            <Button variant="ghost" onClick={() => setMode("reject")} disabled={busy}>Request changes</Button>
          </>
        )}
        {mode === "edit" && (
          <>
            <Button onClick={() => send({ decision: "approve", edit })} disabled={busy}>✓ Approve edited</Button>
            <Button variant="ghost" onClick={() => setMode("review")} disabled={busy}>Back</Button>
          </>
        )}
        {mode === "reject" && (
          <>
            <Button onClick={() => send({ decision: "reject", feedback })} disabled={busy || !feedback.trim()}>Send back</Button>
            <Button variant="ghost" onClick={() => setMode("review")} disabled={busy}>Back</Button>
          </>
        )}
      </div>
    </div>
  );
}
