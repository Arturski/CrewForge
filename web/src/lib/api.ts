// Typed API client for the CrewForge control plane.

export interface FieldSpec {
  name: string;
  type: string;
  required: boolean;
  optional: boolean;
  default: unknown;
  description: string | null;
  ui: { control: string; options?: string[]; numeric?: string; item?: { control: string }; note?: string };
}

export interface Manifest {
  crewai_version: string;
  counts: Record<string, number>;
  models: Record<string, FieldSpec[]>;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string;
  agents: number;
  tasks: number;
}

export interface AgentSpec { id: string; role: string; goal: string; backstory: string }
export interface TaskSpec { agent: string; description: string; expected_output: string; human_input?: boolean }
export interface Workspace {
  id: string; name: string; description: string; process: string;
  agents: AgentSpec[]; tasks: TaskSpec[];
}

export interface RunEvent {
  seq: number; ts: string; kind: string;
  agent?: string; crew?: string; decision?: string; status?: string; error?: string; chars?: number;
}

export interface RunRecord {
  id: string; status: "running" | "succeeded" | "failed";
  dry_run: boolean; spec_name: string; started_at: string; finished_at: string | null;
  result: string | null; error: string | null; event_count: number;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const api = {
  health: () => get<{ status: string; crewai_version: string; version: string }>("/api/health"),
  manifest: () => get<Manifest>("/api/manifest"),
  workspaces: () => get<{ workspaces: WorkspaceSummary[] }>("/api/workspaces"),
  workspace: (id: string) => get<Workspace>(`/api/workspaces/${id}`),
  startRun: (workspace_id: string) => post<{ run_id: string }>("/api/runs", { workspace_id }),
  runs: () => get<{ runs: RunRecord[] }>("/api/runs"),
  run: (id: string) => get<RunRecord>(`/api/runs/${id}`),
};
