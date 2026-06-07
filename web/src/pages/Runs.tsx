import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type RunEvent, type RunRecord } from "../lib/api";
import { Badge, Button, Card, CardHeader } from "../components/ui";
import { EventTimeline } from "../components/EventTimeline";

const STATUS_TONE = { running: "running", succeeded: "ok", failed: "danger" } as const;

export function Runs() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [recent, setRecent] = useState<RunRecord[]>([]);
  const esRef = useRef<EventSource | null>(null);

  function refreshRecent() {
    api.runs().then((d) => setRecent(d.runs)).catch(() => {});
  }
  useEffect(refreshRecent, [runId]);

  // Live SSE subscription for the selected run.
  useEffect(() => {
    esRef.current?.close();
    setEvents([]);
    setRecord(null);
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

  async function startDemo() {
    const { run_id } = await api.startRun("demo-research-crew");
    setParams({ run: run_id });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Runs</h1>
          <p className="text-sm text-muted">Live observability via the CrewAI event bus (SSE).</p>
        </div>
        <Button onClick={startDemo}>▶ Run demo crew</Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader
            title={runId ? `Run ${runId}` : "Live event timeline"}
            sub={record?.spec_name}
            right={
              record && (
                <Badge tone={STATUS_TONE[record.status]}>
                  {record.status}{record.dry_run ? " · dry-run" : ""}
                </Badge>
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
                <span className="font-mono text-xs text-ink">{r.id}</span>
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
