# CrewForge Architecture

This document is the technical reference for anyone building on, extending, or debugging CrewForge.

---

## System overview

CrewForge is a **single-process, self-hosted web application**. The Python backend and React frontend are bundled into one server — no separate worker process, message queue, or external database required.

```
Browser (SPA)
    │  REST + SSE
    ▼
FastAPI (server/app.py)        ← serves web/dist + all /api/* routes
    ├── SQLite (store.py)       ← all persistent state
    ├── Runner threads          ← one thread per active run
    ├── Scheduler thread        ← fires cron + webhook triggers
    └── CrewAI (crewai)         ← the AI execution engine
```

### Key properties

| Property | Value |
|----------|-------|
| Database | SQLite in WAL mode; JSON blobs for structured data |
| Concurrency | One background thread per run; in-process scheduler |
| Auth | None (single-user; webhook token is the only auth surface) |
| Secrets | Fernet-encrypted at rest; decrypted in-process only |
| Network | No outbound calls except to the configured LLM provider |
| Deployment | Single `uvicorn` process; serves the built SPA from `web/dist/` |

---

## Backend modules

### `server/app.py` — Control plane

All ~50 REST endpoints and 2 SSE streams. Serves the SPA (`web/dist/`) for any non-`/api` path. Key patterns:

- **SSE streams**: `GET /api/runs/{id}/events/stream` — long-lived response; the client reconnects on disconnect. Events are broadcast via an in-memory `asyncio.Queue` keyed by run ID.
- **Background work**: run, batch, eval, and schedule drivers all start daemon threads; the API returns immediately with an ID the client can poll/stream.

### `server/store.py` — SQLite persistence

Connection-per-operation, WAL mode. All structured data lives in JSON blobs to avoid schema migrations. Tables:

| Table | Contents |
|-------|----------|
| `workspaces` | Spec (agents, tasks, inputs, settings) |
| `runs` | Status, result, cost, trigger, batch/eval tags |
| `events` | Per-run event log (seq, ts, kind, payload) |
| `settings` | Key/value store (LLMs, MCP servers, tool configs) |
| `personas` | Reusable agent definitions |
| `knowledge_bases` | KB metadata; sources in `kb_sources`; chunks in `kb_chunks` |
| `schedules` | Cron/webhook trigger records |
| `batches` | Batch run metadata + per-row run IDs |
| `evals` | Eval run metadata + per-case scored results |

### `server/runner.py` — Run execution

The critical path:

1. `RunManager.start()` creates a run record, sets up a cancel event, and spawns a daemon thread.
2. The thread calls `compiler/adapter.py` to build a live `Crew`.
3. `crew.kickoff(inputs=...)` starts execution.
4. A `BaseEventListener` (scoped to this run) captures all CrewAI events and writes them to the store + SSE queue.
5. On completion, the run record is updated with `status`, `result`, `cost`, and `finished_at`.

**HITL gate**: when CrewAI calls a task's guardrail function, the runner blocks on a `threading.Event`. `POST /api/runs/{id}/input` resolves it.

**Cancellation**: `_wrap_cancel` shadows `llm.call` on every LLM instance. At each call it checks the cancel event and raises `RuntimeError("cancelled")` if set.

### `server/compiler/`

| Module | Responsibility |
|--------|---------------|
| `manifest.py` | Introspects the installed `crewai` Pydantic models → field manifest. Discovers ~136 fields (Agent/Task/Crew scalars, enums, booleans). The UI renders forms from this manifest, so new CrewAI fields appear with zero code changes. |
| `adapter.py` | Spec dict → live `Crew`, `Agent`, `Task` objects. Resolves LLM connections, attaches MCP tools and knowledge tools, handles conditional tasks, planning, memory, structured outputs. `FakeLLM` is defined here. |
| `exporter.py` | Spec dict → downloadable zip of a runnable CrewAI project (Python files + `config/agents.yaml` + `config/tasks.yaml` + `requirements.txt`). No CrewForge dependency in the output. |
| `tools.py` | Catalog of 103 built-in `crewai_tools` classes. Introspects each for Pydantic params and `EnvVar` requirements. Config stored encrypted in settings. |

### `server/knowledge/`

| Module | Responsibility |
|--------|---------------|
| `kb.py` | CRUD + background ingest orchestration. Ingest runs in a thread; `src.progress` is polled by the UI. |
| `vector.py` | Chunk text → fastembed embeddings → cosine search. Keyless; `bge-small-en-v1.5` (~130 MB, cached on first use). |
| `graph.py` | Per-KB embedded Kuzu graph. Chunk and Entity nodes, MENTIONS/RELATED edges. `build()` is explicit (button-triggered), incremental (only ungraphed chunks). Neighborhood queries for hybrid retrieval. |
| `extract.py` | Prompts the default LLM to extract entities and relations from a text chunk. Parses JSON tolerantly. Requires a live model. |
| `web.py` | Fetches a URL; optionally crawls same-host links up to `max_pages`. stdlib only. |
| `github.py` | Downloads a public GitHub repo as a tarball via `codeload.github.com`. Extracts text files for ingest. |

### `server/batches.py` — Batch runner

Runs one workflow over many input rows (from CSV or a list of dicts). Each row becomes a **first-class tracked run** — with its own timeline, canvas replay, cost, and cancel — sharing a `batch_id`. The driver runs rows **sequentially** (no rate-limit pileups). `cancel()` stops the driver loop and cancels the in-flight run.

### `server/evals.py` — Evaluation suite

Runs a workflow over a saved **test set** and scores each output. Check types:

| Type | Description |
|------|-------------|
| `contains` | Case-insensitive substring match (default) or exact case |
| `not_contains` | Inverse |
| `equals` | Full-string equality after trim + lowercase |
| `regex` | Python `re.search`; bad regex is reported, not raised |
| `judge` | LLM-as-judge: model grades output against a criterion; fails cleanly in dry-run |

`score_output()` is a pure function — fully unit-testable without a server.

### `server/schedules.py` — Scheduler

An in-process daemon thread ticks every 15 seconds. For each enabled schedule whose `next_run_at ≤ now`, it advances `next_run_at` **before** starting the run (crash-safe; can't hot-loop). Webhooks: `POST /api/hooks/{ws_id}/{token}` triggers an immediate run; the token is a capability URL stored on the workspace spec.

### `server/llms.py` — LLM connections

Multiple named connections (id, name, model, base_url, temperature, api_key). Keys encrypted by `secrets.py`. `resolve(llm_id)` returns the decrypted config for a given connection ID, falling back to the default. Used by `adapter.py` (per-workflow/per-agent LLM), `evals.py` (judge), and `knowledge/extract.py` (graph extraction).

### `server/mcp.py` — MCP integration

Connects to MCP servers (stdio, SSE, streamable-HTTP) using `MCPServerAdapter` from crewai. Discovers tools, caches server state. `server/registry.py` proxies the official MCP registry search for the marketplace UI. `server/security.py` assesses tool risk (prompt injection, rug-pull heuristics).

---

## Frontend pages

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/` | Workflow cards, quick-start templates, stat chips (runs, cost, active model) |
| Builder | `/workspaces/:id` | Canvas editor + inspector + run control + Tests card |
| Runs | `/runs` | Run list, timeline, batch panel, eval panel, HITL panel |
| Tools | `/tools` | Built-in catalog tab + MCP integrations/marketplace tab |
| Knowledge | `/knowledge` | KB list, source management, test search, graph viz |
| Settings | `/settings` | LLM connection CRUD |
| Code | `/code` | Read-only export viewer |

### Key frontend patterns

- **`lib/api.ts`**: typed fetch wrapper; every endpoint has a typed method and response interface. Zero `any`.
- **`components/CrewCanvas.tsx`**: XyFlow canvas with custom agent/task nodes. Run-aware: nodes glow running/done/error via run events. Editable (drag, palette add, delete) in Builder; read-only in Runs.
- **`components/EventTimeline.tsx`**: renders the SSE event stream as a collapsible timeline. Shows agent, tool I/O, HITL gates, errors, cost, and duration per task.
- **`components/ui.tsx`**: Radix-backed primitive components (Button, Card, Input, Select, Badge, Tooltip, Dialog, Tabs, Switch) styled with Tailwind v4 CSS variables. No class-variance-authority or external component library.
- **Autosave**: Builder debounces spec changes and calls `PUT /api/workspaces/{id}`.

---

## Data model

A **workspace** is the unit of work — it maps 1:1 to a CrewAI `Crew`. Core spec shape:

```typescript
interface Workspace {
  id: string;
  name: string;
  process: "sequential" | "hierarchical";
  agents: AgentSpec[];        // role, goal, backstory, tools[], llm_id
  tasks: TaskSpec[];          // agent, description, expected_output, condition?, human_input?
  inputs?: { name, default }[]; // run-time {var} substitution
  llm_id?: string;            // workflow-level LLM override
  planning?: boolean;
  memory?: boolean;
  knowledge?: string[];       // KB ids attached to all agents
  eval_cases?: EvalCase[];    // saved test set (versions with the spec)
  hook_token?: string;        // webhook capability token
}
```

A **run** record:

```typescript
interface RunRecord {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  dry_run: boolean;
  trigger: "manual" | "webhook" | `schedule:${string}` | `batch:${string}` | `eval:${string}`;
  result: string | null;
  cost: number | null;        // estimated USD
  tokens: number;
  batch_id?: string;
  batch_index?: number;
  inputs?: Record<string, string>;
}
```

---

## Adding CrewAI features

**Attribute-level features** (new scalar/bool/enum fields on Agent/Task/Crew): nothing to do — `manifest.py` discovers them automatically and the Builder's "Advanced" panel renders them.

**Structural features** (new process type, decorator, memory backend):
1. Add mapping in `compiler/adapter.py`
2. Update `compiler/exporter.py` to emit it in the project zip
3. Add a UI control in the relevant Builder card if it's not a plain field

---

## Testing

52 pytest tests; no network, no API key, no model download.

```bash
uv run --extra dev pytest -q
```

Test files cover: core runs, HITL, conditional tasks, pricing, knowledge graph, KB phase-2 ingest, built-in tools, schedules, batches, and evals (all check types including judge).

Key test patterns:
- `_StubRuns` — stands in for `RunManager`, returns canned results
- `_FakeLLM` — same as the production `FakeLLM` but used directly in unit tests
- `store.init()` — initialises an in-memory SQLite for each test that touches the store
