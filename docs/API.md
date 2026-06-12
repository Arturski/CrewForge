# CrewForge API Reference

All endpoints are served at `http://localhost:8765/api/` by default. The API is a standard REST API with JSON bodies. SSE streams return `text/event-stream`.

**Base URL:** `http://localhost:8765`

---

## Health

### `GET /api/health`

```json
{ "status": "ok", "crewai_version": "1.14.6", "version": "0.2.0" }
```

---

## Manifest

### `GET /api/manifest`

Returns the CrewAI field manifest — all configurable fields introspected from the installed `crewai` package. Used by the Builder's dynamic forms.

```json
{
  "crewai_version": "1.14.6",
  "counts": { "Agent": 42, "Task": 18, "Crew": 12 },
  "models": {
    "Agent": [
      { "name": "verbose", "type": "boolean", "required": false, "default": false, "ui": { "control": "toggle" } }
    ]
  }
}
```

---

## Workspaces

### `GET /api/workspaces`
List all workspaces (summary view — no agents/tasks detail).

### `POST /api/workspaces`
Create a workspace. Body: `{ "name": string, "template"?: string }`. Returns full `Workspace`.

### `GET /api/workspaces/{id}`
Get full workspace spec.

### `PUT /api/workspaces/{id}`
Save/update a workspace spec. Body: full `Workspace` object. Returns updated spec.

### `DELETE /api/workspaces/{id}`
Delete workspace and all associated runs.

### `POST /api/workspaces/{id}/duplicate`
Clone a workspace. Returns the new workspace.

### `GET /api/workspaces/{id}/code`
Export the workspace as generated Python code.
```json
{ "files": { "src/crew.py": "...", "config/agents.yaml": "..." } }
```

### `GET /api/workspaces/{id}/export`
Download a zip of the runnable CrewAI project. Returns `application/zip`.

### `POST /api/workspaces/{id}/hook`
Generate a webhook token for this workspace.
```json
{ "url": "http://localhost:8765/api/hooks/ws-abc123/token-xyz" }
```

### `DELETE /api/workspaces/{id}/hook`
Revoke the webhook token.

---

## Runs

### `POST /api/runs`
Start a run.
```json
{
  "workspace_id": "ws-abc123",
  "dry_run": true,
  "inputs": { "topic": "quantum computing" }
}
```
Response: `{ "run_id": "017abc..." }`

### `GET /api/runs`
List recent runs (last 50).

### `GET /api/runs/{id}`
Get run record including status, result, cost, tokens, trigger.

### `POST /api/runs/{id}/cancel`
Cancel an in-progress run. Returns `{ "ok": true }`.

### `POST /api/runs/{id}/input`
Resolve a HITL gate.
```json
{
  "decision": "approve",        // "approve" | "reject"
  "edit": "Optional edited output text",
  "feedback": "Optional feedback for reject loop"
}
```

### `GET /api/runs/{id}/events`
Get all stored events for a run (array).

### `GET /api/runs/{id}/events/stream`
SSE stream of events as they fire. Each `data:` line is a JSON event object.
```
data: {"seq": 1, "ts": "...", "kind": "agent.start", "agent": "Research Analyst"}
data: {"seq": 2, "ts": "...", "kind": "llm.call", "tokens": 450}
data: {"seq": 3, "ts": "...", "kind": "run.finished", "status": "succeeded", "cost": 0.0012}
```

**Event kinds:** `run.start`, `run.finished`, `agent.start`, `agent.finish`, `task.start`, `task.finish`, `task.skipped`, `llm.call`, `llm.stream`, `tool.start`, `tool.finish`, `tool.error`, `hitl.waiting`, `hitl.resolved`

---

## Webhooks

### `POST /api/hooks/{ws_id}/{token}`
Trigger a run via webhook. Body is optional:
```json
{ "inputs": { "topic": "AI news" }, "dry_run": false }
```
Response: `{ "run_id": "017abc..." }`

---

## Batches

### `GET /api/batches?workspace_id={id}`
List batches, optionally filtered by workspace.

### `POST /api/batches`
Start a batch run.
```json
{
  "workspace_id": "ws-abc123",
  "dry_run": true,
  "name": "My batch",
  "csv": "topic\nquantum computing\nclimate change",
  // OR:
  "rows": [{ "topic": "quantum computing" }, { "topic": "climate change" }]
}
```
Response: full `Batch` record.

### `GET /api/batches/{id}`
Get batch record, including the embedded `runs` array.

### `POST /api/batches/{id}/cancel`
Cancel a running batch. Returns `{ "ok": true }`.

---

## Evaluations

### `GET /api/evals?workspace_id={id}`
List eval runs.

### `POST /api/evals/run`
Start an eval run.
```json
{
  "workspace_id": "ws-abc123",
  "dry_run": false,
  "name": "Regression check",
  "cases": [
    {
      "inputs": { "topic": "quantum computing" },
      "checks": [
        { "type": "contains", "value": "qubit" },
        { "type": "judge", "value": "is factually accurate about quantum computing" }
      ]
    }
  ]
}
```
If `cases` is omitted, uses `workspace.eval_cases`. Check types: `contains`, `not_contains`, `equals`, `regex`, `judge`.

### `GET /api/evals/{id}`
Get eval run with per-case results and per-check pass/fail.

### `POST /api/evals/{id}/cancel`
Cancel a running eval. Returns `{ "ok": true }`.

---

## Schedules

### `GET /api/schedules?workspace_id={id}`
List schedules.

### `POST /api/schedules`
Create a schedule.
```json
{
  "workspace_id": "ws-abc123",
  "cron": "0 9 * * *",
  "dry_run": false,
  "inputs": { "topic": "daily news" }
}
```

### `PUT /api/schedules/{id}`
Update a schedule. Body: partial `{ cron, dry_run, enabled, inputs }`.

### `DELETE /api/schedules/{id}`
Delete a schedule.

---

## LLM Connections

### `GET /api/llms`
```json
{
  "llms": [
    { "id": "llm-abc", "name": "OpenAI GPT-4o", "model": "gpt-4o", "base_url": "", "temperature": null, "api_key_set": true }
  ],
  "default": "llm-abc"
}
```

### `POST /api/llms`
Add or update an LLM connection. Pass `id` to update an existing one.
```json
{
  "name": "My LLM",
  "model": "gpt-4o",
  "base_url": "",
  "api_key": "sk-...",
  "temperature": 0.7
}
```

### `DELETE /api/llms/{id}`
Remove an LLM connection.

### `PUT /api/llms/default`
Set the default connection. Body: `{ "id": "llm-abc" }`.

### `POST /api/llms/models`
Fetch available model names from a provider.
```json
{ "provider": "openai", "api_key": "sk-..." }
```

### `POST /api/llms/test`
Test a connection (makes a real call).
```json
{ "id": "llm-abc" }
// OR inline config:
{ "model": "gpt-4o", "base_url": "", "api_key": "sk-..." }
```
Response: `{ "ok": true, "sample": "ok" }` or `{ "ok": false, "error": "..." }`.

---

## Tools

### `GET /api/tools`
List all available tools (built-in + MCP).
```json
{ "tools": [{ "name": "SerperDevTool", "description": "...", "kind": "builtin", "configured": false, "missing_env": ["SERPER_API_KEY"] }] }
```

### `GET /api/tools/builtin/{name}`
Get config and params for a built-in tool.

### `PUT /api/tools/builtin/{name}/config`
Save configuration for a built-in tool.
```json
{ "args": { "n_results": 10 }, "env": { "SERPER_API_KEY": "abc123" } }
```

### `DELETE /api/tools/builtin/{name}/config`
Reset a tool's configuration.

---

## MCP Servers

### `GET /api/mcp`
List connected MCP servers.

### `POST /api/mcp`
Connect a new MCP server.
```json
{
  "name": "my-server",
  "transport": "stdio",
  "command": "npx -y @modelcontextprotocol/server-filesystem /tmp"
}
```

### `POST /api/mcp/{id}/rescan`
Re-connect and refresh tool list.

### `DELETE /api/mcp/{id}`
Disconnect an MCP server.

### `GET /api/registry?q={query}`
Search the official MCP registry.

---

## Knowledge Bases

### `GET /api/knowledge`
List all knowledge bases.

### `POST /api/knowledge`
Create a KB. Body: `{ "name": string, "description"?: string }`.

### `GET /api/knowledge/{id}`
Get KB metadata + sources + graph state.

### `DELETE /api/knowledge/{id}`
Delete KB and all its sources, chunks, and graph.

### `POST /api/knowledge/{id}/sources`
Add a source to a KB. Ingest runs in the background.
```json
{
  "kind": "text",         // "text" | "file" | "url" | "github"
  "text": "Raw text content",
  // For file upload:
  "filename": "doc.pdf",
  "content_b64": "<base64>",
  // For URL:
  "url": "https://docs.example.com",
  "crawl": true,
  "max_pages": 20,
  // For GitHub:
  "url": "https://github.com/owner/repo"
}
```

### `POST /api/knowledge/{id}/search`
Test search against a KB.
```json
{ "q": "What is a qubit?" }
```
Response: `{ "results": [{ "text": "...", "score": 0.87, "source": "doc.pdf" }], "facts": [...] }`.

### `GET /api/knowledge/{id}/graph`
Get the Kuzu graph state (entities, relations, build status).

### `POST /api/knowledge/{id}/graph/build`
Trigger a knowledge graph build (LLM entity/relation extraction). Incremental — only processes ungraphed chunks.

---

## Personas

### `GET /api/personas`
List all agent personas.

### `POST /api/personas`
Save a persona. Body: `{ name, role, goal, backstory, tags?, suggested_tools? }`.

### `DELETE /api/personas/{id}`
Delete a persona.

---

## Templates

### `GET /api/templates`
List starter workflow templates.
