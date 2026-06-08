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
  "agent.error": "var(--color-danger)",
  "tool.started": "var(--color-warn)",
  "tool.finished": "var(--color-warn)",
  "mcp.tools.attached": "var(--color-running)",
  "mcp.error": "var(--color-danger)",
  "hitl.gate.reached": "var(--color-warn)",
  "hitl.decision.received": "var(--color-warn)",
};

function fmtMs(ms?: number): string | null {
  if (ms == null) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function detail(e: RunEvent): string {
  return [
    e.agent && `agent=${e.agent}`,
    e.task && `· ${e.task}`,
    e.tool && `tool=${e.tool}`,
    e.crew && e.kind === "run.started" && `crew=${e.crew}`,
    e.decision,
    e.error,
  ].filter(Boolean).join("  ");
}

export function EventTimeline({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted">No events yet — start a run.</div>;
  }
  return (
    <div className="max-h-[420px] overflow-y-auto px-2 py-2 font-mono text-xs">
      {events.map((e) => {
        const dur = fmtMs(e.ms);
        return (
          <div key={e.seq} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-elevated2">
            <span className="w-6 text-right text-muted">{e.seq}</span>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_TONE[e.kind] ?? "var(--color-muted)" }} />
            <span className="shrink-0 text-ink">{e.kind}</span>
            <span className="truncate text-muted">{detail(e)}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {e.tokens != null && <span className="rounded bg-elevated2 px-1.5 py-0.5 text-[10px] text-running">{e.tokens} tok</span>}
              {dur && <span className="rounded bg-elevated2 px-1.5 py-0.5 text-[10px] text-muted">{dur}</span>}
              <span className="text-[10px] text-muted">{new Date(e.ts).toLocaleTimeString()}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
