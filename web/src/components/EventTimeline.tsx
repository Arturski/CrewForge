import type { RunEvent } from "../lib/api";

const KIND_TONE: Record<string, string> = {
  "run.started": "var(--color-brand)",
  "run.finished": "var(--color-ok)",
  "run.failed": "var(--color-danger)",
  "crew.kickoff.started": "var(--color-brand)",
  "crew.kickoff.completed": "var(--color-ok)",
  "task.started": "var(--color-node-task)",
  "task.completed": "var(--color-node-task)",
  "agent.execution.started": "var(--color-node-agent)",
  "agent.execution.completed": "var(--color-node-agent)",
  "hitl.gate.reached": "var(--color-warn)",
  "hitl.decision.received": "var(--color-warn)",
};

function detail(e: RunEvent): string {
  return [e.agent && `agent=${e.agent}`, e.crew && `crew=${e.crew}`, e.decision, e.status, e.error]
    .filter(Boolean).join("  ");
}

export function EventTimeline({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted">No events yet — start a run.</div>;
  }
  return (
    <div className="max-h-[420px] overflow-y-auto px-2 py-2 font-mono text-xs">
      {events.map((e) => (
        <div key={e.seq} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-elevated2">
          <span className="w-6 text-right text-muted">{e.seq}</span>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_TONE[e.kind] ?? "var(--color-muted)" }} />
          <span className="text-ink">{e.kind}</span>
          <span className="text-muted">{detail(e)}</span>
          <span className="ml-auto text-[10px] text-muted">{new Date(e.ts).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}
