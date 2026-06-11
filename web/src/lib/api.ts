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
  llm_id?: string; // configured LLM connection; blank = workflow default
  // agents may carry any additional crewai field set via the advanced panel
  [key: string]: unknown;
}
export interface TaskCondition {
  check: "contains" | "not_contains" | "regex";
  value: string;
  case_sensitive?: boolean;
}
export interface TaskSpec {
  agent: string; description: string; expected_output: string;
  human_input?: boolean; name?: string; rules?: string;
  context?: number[]; // indices of earlier tasks whose output feeds this one
  condition?: TaskCondition; // run only if the previous task's output passes
  [key: string]: unknown;
}
export interface Workspace {
  id: string; name: string; description: string; process: string;
  agents: AgentSpec[]; tasks: TaskSpec[];
  skills?: string[]; // workflow-level skills, shared by all agents
  layout?: Record<string, { x: number; y: number }>; // canvas node positions
  inputs?: { name: string; description?: string; default?: string }[]; // run-time params
  planning?: boolean; // crew plans before executing
  memory?: boolean; // crew memory (live runs)
  knowledge?: string[]; // workflow-level knowledge base ids
  hook_token?: string; // webhook trigger token (POST /api/hooks/{id}/{token})
  llm_id?: string; // configured LLM connection for the whole crew; blank = default
  manager_agent_id?: string; // hierarchical only: agent that manages the crew
}

export interface RunEvent {
  seq: number; ts: string; kind: string;
  agent?: string; crew?: string; decision?: string; status?: string;
  error?: string; chars?: number; mode?: string; tokens?: number;
  task?: string; task_index?: number; ms?: number; tool?: string; count?: number;
  cost?: number | null; // run.finished: estimated USD
}

export interface RunRecord {
  id: string; status: "running" | "succeeded" | "failed" | "cancelled";
  dry_run: boolean; spec_name: string; started_at: string; finished_at: string | null;
  result: string | null; error: string | null; event_count: number; tokens?: number;
  cost?: number | null; // estimated USD from tokens × curated pricing (live runs)
  trigger?: string; // manual | webhook | schedule:<id>
  workspace_id?: string;
  inputs?: Record<string, string>; // run-time variables this run started with
  hitl?: { output: string; since: string } | null; // set while blocked at a human gate
}

export interface LlmSettings {
  configured: boolean; model: string; base_url: string;
  temperature: number | null; api_key_set: boolean;
}

// One named LLM connection (multiple may be configured; one is the default).
export interface LlmConfig {
  id: string; name: string; model: string; base_url: string;
  temperature: number | null; api_key_set: boolean;
}

export interface Persona {
  id: string; name: string; role: string; goal: string; backstory: string;
  tags: string[]; suggested_tools: string[];
}
export interface TemplateSummary {
  id: string; name: string; description: string; agents: number; tasks: number;
}

export interface Schedule {
  id: string; workspace_id: string; workspace_name?: string;
  cron: string; inputs: Record<string, string>; dry_run: boolean; enabled: boolean;
  next_run_at: string | null; last_run_at: string | null; last_run_id: string | null;
}

export interface KnowledgeSource {
  id: string; kb_id: string; kind: string; ref: string;
  status: "processing" | "ready" | "error"; chunks: number; error?: string | null;
  progress?: string | null; // live ingest status, e.g. "12/30 pages"
}
export interface KbGraphState {
  status: "none" | "building" | "ready" | "error";
  progress?: string; error?: string;
  entities?: number; relations?: number; chunks?: number; skipped?: number;
}
export interface KbGraphEntity { name: string; label: string; type: string; degree: number }
export interface KbGraphFact { source: string; label: string; target: string }
export interface KbGraph { graph: KbGraphState; entities: KbGraphEntity[]; relations: KbGraphFact[] }
export interface KnowledgeBase {
  id: string; name: string; description: string; embedder: string; created: string;
  stats: { sources: number; chunks: number }; sources?: KnowledgeSource[];
  graph?: KbGraphState;
}
export interface SearchHit { text: string; score: number; source: string }

export interface ToolParam { name: string; type: string; default?: unknown; required: boolean }
export interface ToolEnvVar { name: string; required: boolean }
export interface ToolInfo {
  name: string; description: string;
  kind?: "builtin" | "mcp"; server?: string; server_id?: string; risk?: string;
  configured?: boolean; missing_env?: string[];
  env_vars?: ToolEnvVar[]; params?: ToolParam[];
}
export interface ToolConfig {
  params: ToolParam[]; env_vars: ToolEnvVar[];
  config: { args: Record<string, unknown>; env: Record<string, string> };
  configured: boolean; missing_env: string[];
}

export interface McpTool { name: string; description: string }
export interface SecurityAssessment {
  level: "low" | "medium" | "high"; label: string; factors: string[]; scanner: string;
}
export interface McpServer {
  id: string; name: string; transport: "stdio" | "sse" | "streamable-http";
  status: "connected" | "error"; risk: string; error?: string | null;
  tools: McpTool[]; command?: string; url?: string; security?: SecurityAssessment;
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
  status: string; risk: string; install: RegistryInstall; security?: SecurityAssessment;
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
  schedules: (workspaceId?: string) =>
    req<{ schedules: Schedule[] }>(`/api/schedules${workspaceId ? `?workspace_id=${workspaceId}` : ""}`),
  createSchedule: (body: { workspace_id: string; cron: string; dry_run?: boolean; inputs?: Record<string, string> }) =>
    req<Schedule>("/api/schedules", json("POST", body)),
  updateSchedule: (id: string, body: Partial<Pick<Schedule, "cron" | "dry_run" | "enabled" | "inputs">>) =>
    req<Schedule>(`/api/schedules/${id}`, json("PUT", body)),
  deleteSchedule: (id: string) => req<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),
  createHook: (wsId: string) => req<{ url: string }>(`/api/workspaces/${wsId}/hook`, { method: "POST" }),
  deleteHook: (wsId: string) => req<{ ok: boolean }>(`/api/workspaces/${wsId}/hook`, { method: "DELETE" }),
  builtinTool: (name: string) => req<ToolConfig>(`/api/tools/builtin/${name}`),
  setBuiltinToolConfig: (name: string, body: { args: Record<string, unknown>; env: Record<string, string> }) =>
    req<ToolConfig>(`/api/tools/builtin/${name}/config`, json("PUT", body)),
  deleteBuiltinToolConfig: (name: string) => req<{ ok: boolean }>(`/api/tools/builtin/${name}/config`, { method: "DELETE" }),

  workspaces: () => req<{ workspaces: WorkspaceSummary[] }>("/api/workspaces"),
  workspace: (id: string) => req<Workspace>(`/api/workspaces/${id}`),
  createWorkspace: (name: string, template?: string) =>
    req<Workspace>("/api/workspaces", json("POST", { name, ...(template ? { template } : {}) })),
  duplicateWorkspace: (id: string) => req<Workspace>(`/api/workspaces/${id}/duplicate`, { method: "POST" }),
  personas: () => req<{ personas: Persona[] }>("/api/personas"),
  savePersona: (p: Partial<Persona>) => req<Persona>("/api/personas", json("POST", p)),
  deletePersona: (id: string) => req<{ ok: boolean }>(`/api/personas/${id}`, { method: "DELETE" }),
  templates: () => req<{ templates: TemplateSummary[] }>("/api/templates"),
  saveWorkspace: (ws: Workspace) => req<Workspace>(`/api/workspaces/${ws.id}`, json("PUT", ws)),
  deleteWorkspace: (id: string) => req<{ ok: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" }),
  code: (id: string) => req<{ files: Record<string, string> }>(`/api/workspaces/${id}/code`),
  exportUrl: (id: string) => `/api/workspaces/${id}/export`,

  getLlm: () => req<LlmSettings>("/api/settings/llm"),
  saveLlm: (cfg: Partial<{ model: string; base_url: string; temperature: number; api_key: string; clear_api_key: boolean }>) =>
    req<{ ok: boolean }>("/api/settings/llm", json("PUT", cfg)),

  // Multiple named LLM connections (selectable per workflow / per agent).
  llms: () => req<{ llms: LlmConfig[]; default: string | null }>("/api/llms"),
  saveLlm2: (cfg: Partial<{ id: string; name: string; model: string; base_url: string; temperature: number; api_key: string }>) =>
    req<{ id: string; name: string }>("/api/llms", json("POST", cfg)),
  deleteLlm: (id: string) => req<{ ok: boolean }>(`/api/llms/${id}`, { method: "DELETE" }),
  setDefaultLlm: (id: string) => req<{ ok: boolean }>("/api/llms/default", json("PUT", { id })),
  testLlm: (cfg: Partial<{ id: string; model: string; base_url: string; api_key: string }>) =>
    req<{ ok: boolean; sample?: string; error?: string }>("/api/llms/test", json("POST", cfg)),
  providerModels: (cfg: { provider: string; base_url?: string; api_key?: string; id?: string }) =>
    req<{ models: string[]; error?: string }>("/api/llms/models", json("POST", cfg)),

  knowledgeBases: () => req<{ knowledge_bases: KnowledgeBase[] }>("/api/knowledge"),
  createKnowledge: (name: string, description = "") => req<KnowledgeBase>("/api/knowledge", json("POST", { name, description })),
  knowledgeBase: (id: string) => req<KnowledgeBase>(`/api/knowledge/${id}`),
  deleteKnowledge: (id: string) => req<{ ok: boolean }>(`/api/knowledge/${id}`, { method: "DELETE" }),
  addKbSource: (id: string, body: { kind: string; text?: string; filename?: string; content_b64?: string; url?: string; crawl?: boolean; max_pages?: number }) =>
    req<KnowledgeSource>(`/api/knowledge/${id}/sources`, json("POST", body)),
  searchKb: (id: string, q: string) => req<{ results: SearchHit[]; facts: KbGraphFact[] }>(`/api/knowledge/${id}/search`, json("POST", { q })),
  kbGraph: (id: string) => req<KbGraph>(`/api/knowledge/${id}/graph`),
  buildKbGraph: (id: string) => req<KbGraphState>(`/api/knowledge/${id}/graph/build`, { method: "POST" }),

  registry: (q: string) => req<{ servers: RegistryServer[]; error?: string }>(`/api/registry?q=${encodeURIComponent(q)}`),
  mcpServers: () => req<{ servers: McpServer[] }>("/api/mcp"),
  addMcp: (cfg: McpInput) => req<McpServer>("/api/mcp", json("POST", cfg)),
  rescanMcp: (id: string) => req<McpServer>(`/api/mcp/${id}/rescan`, { method: "POST" }),
  deleteMcp: (id: string) => req<{ ok: boolean }>(`/api/mcp/${id}`, { method: "DELETE" }),

  startRun: (workspace_id: string, dry_run = true, inputs: Record<string, string> = {}) =>
    req<{ run_id: string }>("/api/runs", json("POST", { workspace_id, dry_run, inputs })),
  runs: () => req<{ runs: RunRecord[] }>("/api/runs"),
  run: (id: string) => req<RunRecord>(`/api/runs/${id}`),
  cancelRun: (id: string) => req<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: "POST" }),
  hitlDecision: (id: string, body: { decision: "approve" | "reject"; edit?: string; feedback?: string }) =>
    req<{ ok: boolean }>(`/api/runs/${id}/input`, json("POST", body)),
};
