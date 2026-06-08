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
  id: string; name: string; description: string; agents: number; tasks: number;
}

export interface AgentSpec {
  id: string; role: string; goal: string; backstory: string;
  tools?: string[]; allow_delegation?: boolean;
  // agents may carry any additional crewai field set via the advanced panel
  [key: string]: unknown;
}
export interface TaskSpec {
  agent: string; description: string; expected_output: string;
  human_input?: boolean; name?: string; rules?: string;
  [key: string]: unknown;
}
export interface Workspace {
  id: string; name: string; description: string; process: string;
  agents: AgentSpec[]; tasks: TaskSpec[];
  skills?: string[]; // workflow-level skills, shared by all agents
  layout?: Record<string, { x: number; y: number }>; // canvas node positions
  inputs?: { name: string; description?: string; default?: string }[]; // run-time params
}

export interface RunEvent {
  seq: number; ts: string; kind: string;
  agent?: string; crew?: string; decision?: string; status?: string;
  error?: string; chars?: number; mode?: string; tokens?: number;
}

export interface RunRecord {
  id: string; status: "running" | "succeeded" | "failed";
  dry_run: boolean; spec_name: string; started_at: string; finished_at: string | null;
  result: string | null; error: string | null; event_count: number; tokens?: number;
}

export interface LlmSettings {
  configured: boolean; model: string; base_url: string;
  temperature: number | null; api_key_set: boolean;
}

export interface ToolInfo {
  name: string; description: string;
  kind?: "builtin" | "mcp"; server?: string; server_id?: string; risk?: string;
}

export interface McpTool { name: string; description: string }
export interface McpServer {
  id: string; name: string; transport: "stdio" | "sse" | "streamable-http";
  status: "connected" | "error"; risk: string; error?: string | null;
  tools: McpTool[]; command?: string; url?: string;
}
export interface McpInput {
  name: string; transport: "stdio" | "sse" | "streamable-http";
  command?: string; args?: string[]; env?: Record<string, string>; url?: string;
}

export interface RegistryInstall {
  transport: "stdio" | "sse" | "streamable-http";
  command?: string; args?: string[]; url?: string;
  env_required: string[]; source: string;
}
export interface RegistryServer {
  name: string; title: string; description: string; version?: string;
  status: string; risk: string; install: RegistryInstall;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try { detail = (await r.json()).detail ?? detail; } catch { /* noop */ }
    throw new Error(detail);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const json = (method: string, body: unknown) => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  health: () => req<{ status: string; crewai_version: string; version: string }>("/api/health"),
  manifest: () => req<Manifest>("/api/manifest"),
  tools: () => req<{ tools: ToolInfo[] }>("/api/tools"),

  workspaces: () => req<{ workspaces: WorkspaceSummary[] }>("/api/workspaces"),
  workspace: (id: string) => req<Workspace>(`/api/workspaces/${id}`),
  createWorkspace: (name: string) => req<Workspace>("/api/workspaces", json("POST", { name })),
  saveWorkspace: (ws: Workspace) => req<Workspace>(`/api/workspaces/${ws.id}`, json("PUT", ws)),
  deleteWorkspace: (id: string) => req<{ ok: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" }),
  code: (id: string) => req<{ files: Record<string, string> }>(`/api/workspaces/${id}/code`),
  exportUrl: (id: string) => `/api/workspaces/${id}/export`,

  getLlm: () => req<LlmSettings>("/api/settings/llm"),
  saveLlm: (cfg: Partial<{ model: string; base_url: string; temperature: number; api_key: string; clear_api_key: boolean }>) =>
    req<{ ok: boolean }>("/api/settings/llm", json("PUT", cfg)),
  testLlm: (cfg: Partial<{ model: string; base_url: string; api_key: string }>) =>
    req<{ ok: boolean; sample?: string; error?: string }>("/api/settings/llm/test", json("POST", cfg)),

  registry: (q: string) => req<{ servers: RegistryServer[]; error?: string }>(`/api/registry?q=${encodeURIComponent(q)}`),
  mcpServers: () => req<{ servers: McpServer[] }>("/api/mcp"),
  addMcp: (cfg: McpInput) => req<McpServer>("/api/mcp", json("POST", cfg)),
  rescanMcp: (id: string) => req<McpServer>(`/api/mcp/${id}/rescan`, { method: "POST" }),
  deleteMcp: (id: string) => req<{ ok: boolean }>(`/api/mcp/${id}`, { method: "DELETE" }),

  startRun: (workspace_id: string, dry_run = true, inputs: Record<string, string> = {}) =>
    req<{ run_id: string }>("/api/runs", json("POST", { workspace_id, dry_run, inputs })),
  runs: () => req<{ runs: RunRecord[] }>("/api/runs"),
  run: (id: string) => req<RunRecord>(`/api/runs/${id}`),
};
