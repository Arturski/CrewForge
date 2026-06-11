# CrewForge — Handover

A no-code studio for **CrewAI**: visually design, configure, run, observe agentic workflows, and export a portable CrewAI project. Open-source (Apache-2.0), **self-hosted, single-user**. Repo: https://github.com/Arturski/CrewForge

> This doc is the source of truth for picking up work in a new session. The long-form design + roadmap lives in the plan file referenced at the bottom; this is the practical handover.

---

## Run it
```bash
cd ~/git/CrewForge
uv sync                                   # Python 3.12 pinned
npm --prefix web install                  # first time
npm --prefix web run build                # build the SPA (FastAPI serves web/dist)
uv run uvicorn server.app:app --port 8765 # → http://localhost:8765
#   or one-command launcher: uv run crewforge   (opens the browser)
```
- **Dry-run by default** (built-in mock LLM, no key). To run live: **Models** → set a provider → **Builder** → toggle **Dry run** off.
- Dev with HMR: `uv run uvicorn server.app:app --reload --port 8765` + `npm --prefix web run dev` (proxies /api → :8765).

## Verify / quality gates
```bash
uv run --extra dev ruff check server tests
uv run --extra dev pytest -q          # 39 tests, no network/model download
npm --prefix web run build            # tsc strict
```
Browser-drive with the Playwright MCP; zero console errors is the bar. **Ship phase-by-phase: build → verify → commit → push.**

---

## Architecture (quick map)

**Backend** (`server/`, FastAPI, in-process; SQLite via stdlib `sqlite3`, JSON blobs):
- `app.py` — all REST + SSE endpoints; serves the built SPA.
- `store.py` — SQLite: workspaces, runs, events, settings, personas, knowledge_bases/kb_sources/kb_chunks. Connection-per-op, WAL. Seeds demo workspace + personas on first boot.
- `runner.py` — executes a run in a background thread; subscribes to the **CrewAI event bus** via `scoped_handlers` (sync handlers run on a thread pool, so handlers close over the run record — do NOT use thread-locals). Emits normalized events → store + SSE. Builds per-workflow/per-agent LLMs, attaches MCP + knowledge tools.
- `compiler/manifest.py` — introspects installed crewai Pydantic models → field manifest that drives the UI's "advanced" forms (compatibility engine).
- `compiler/adapter.py` — spec → live `Crew`/`Agent`/`Task`. **`FakeLLM`** = the keyless dry-run mock. `live = not isinstance(llm, FakeLLM)` gates features needing a real model/embedder (memory, structured output `output_pydantic`, planning).
- `compiler/exporter.py` — spec → runnable CrewAI project (zip / Code view). No-lock-in.
- `compiler/tools.py` — built-in crewai_tools catalog (kind=builtin). `compiler/knowledge_tool.py` — `search_<kb>` BaseTool.
- `llms.py` — **multiple LLM connections** (list + default; keys encrypted). `secrets.py` — Fernet encryption (key in `secret.key` next to DB, gitignored).
- `mcp.py` — connect/discover MCP servers (stdio/SSE/HTTP), runtime tool loading via `MCPServerAdapter`. `registry.py` — official MCP registry search (marketplace). `security.py` — honest risk assessment for MCP.
- `knowledge/` — `vector.py` (fastembed local embeddings + chunk + cosine), `kb.py` (CRUD + background ingest with live `progress` + graph-build orchestration), `web.py` (page fetch + same-host crawl, stdlib), `github.py` (public-repo tarball via codeload), `graph.py` (embedded Kuzu per KB: Chunk/Entity nodes, MENTIONS/RELATED edges, overview + neighborhood queries), `extract.py` (LLM entity/relation extraction, tolerant JSON parse). `providers.py` — live model-list fetch per provider.
- `personas.py` — 10 seeded persona defaults (then store-backed CRUD). `templates.py` — 3 starter workflow specs. `cli.py` — `crewforge` launcher.

**Frontend** (`web/`, React 19 + Vite + Tailwind v4 + **shadcn-style on Radix** + XyFlow; routes lazy-loaded):
- `components/ui.tsx` — Radix-backed primitives (Button/Card/Input/Select/Badge/Tooltip/Toggle(Switch)/Modal(Dialog)/Tabs) styled with the token system in `index.css`. `lib/utils.ts` `cn()`.
- `components/CrewCanvas.tsx` — XyFlow editor: custom agent/task nodes, palette add, click-to-select, drag-to-position (persisted in `spec.layout`), delete; **run-aware** (nodes glow running/done/error) + `readOnly` mode.
- `components/EventTimeline.tsx`, `lib/toast.tsx` (sonner), `lib/api.ts` (typed client).
- Pages: `Dashboard` (workflows + templates + stats), `Builder` (canvas + inspector + run control + inputs + workflow settings), `Runs` (run-aware canvas + timeline), `Tools` (Tools catalog + Integrations/MCP marketplace tabs), `Knowledge` (KB CRUD + ingest + test search), `Settings` (Models), `Code` (export viewer).

**Data model:** a *workspace* = a CrewAI **crew**. Spec fields: `name, process(sequential|hierarchical), planning, memory, agents[], tasks[], skills[](workflow tools), knowledge[](workflow KB ids), layout, inputs[], llm_id`. Agent: `role, goal, backstory, tools[], knowledge[], llm_id, + scalar manifest fields`. Task: `name, agent, description, expected_output, rules, human_input, async_execution, output_schema[]`.

---

## What's DONE (shipped + pushed)
- Editable **canvas studio** (create/add/edit/delete agents & tasks; simple tooltip-driven config + manifest "advanced" panel).
- **Single Run** control + Dry-run toggle + **run inputs** (`{var}` → `kickoff(inputs=)`).
- **Live observability**: canvas lights up per run; timeline shows durations, tokens, tool I/O, errors.
- **Tools hub**: built-in catalog + **MCP integrations** (marketplace from official registry, connect local/remote, security ratings) — one "Tools" page, "Integrations → provide → Tools → attached to → Agents".
- **CrewAI depth**: hierarchical process, **planning** (live), **memory** (live), **structured outputs**, **async tasks**, **per-agent scalar fields**.
- **Templates** gallery + **editable persona library** (CRUD + "save agent as persona").
- **Knowledge (Phase 1)**: keyless vector RAG — ingest text/files, semantic search, `search_<kb>` tool attachable to agents/workflow.
- **Models**: provider presets + **live model fetch** (↻ Refresh) + free-text; **MiniMax** fixed (`hosted_vllm/` prefix, no /models endpoint, current models).
- **Code export**, **secrets vault** (encrypted keys), **autosave**, **responsive sidebar**, **route code-splitting**, shadcn/Radix foundation, CI (ruff+pytest+tsc), SECURITY.md, ROADMAP.md.
- **Multi-LLM frontend** (`9328d5d`): connection list in Settings; per-workflow (`ws.llm_id`) + per-agent (`agent.llm_id`) selects in Builder.
- **Knowledge Phase 2** (`8125c5d`): web page ingest + same-host docs-site crawl (`knowledge/web.py`, stdlib only) + GitHub repo via codeload tarball (`knowledge/github.py`); live `src.progress` ("12/30 pages") polled by the UI.
- **Stop/cancel + live HITL** (`03711e8`): `POST /api/runs/{id}/cancel` (aborts at next LLM call via `_wrap_cancel` shadowing `llm.call`) and `POST /api/runs/{id}/input`; the guardrail gate now **blocks** on approve / edit-output / request-changes (reject feeds crewai's revision loop); run status gained `cancelled`; Runs page has Stop button + HITL panel.
- **Task dependencies + manager** (`cdabf3d`): `task.context` (indices of earlier tasks) editable as canvas drag-edges or inspector checkboxes; hierarchical `manager_agent_id` (task-free agents only, else LLM manager); exporter emits both; task/agent delete reindexes context + layout.
- **Replay + duplicate** (`3d36f87`): Replay button on terminal runs; `POST /api/workspaces/{id}/duplicate`.
- **MCP env encryption** (`08c8c35`): MCP env values encrypted at rest, masked in all API responses.
- **Knowledge Phase 3 — Kuzu graph layer**: per-KB embedded Kuzu graph (`knowledge/graph.py`), LLM entity/relation extraction (`knowledge/extract.py`, default LLM connection), explicit **Build graph** (never automatic — ingest stays token-free; incremental over ungraphed chunks, live progress on the KB record), hybrid retrieval (`search_<kb>` tool + test-search append "related facts" from the graph), `GET /api/knowledge/{id}/graph` + `POST .../graph/build`, XyFlow graph preview in the Knowledge page (ring layout, hubs centered).
- **Conditional tasks**: `task.condition = {check: contains|not_contains|regex, value, case_sensitive?}` → crewai `ConditionalTask` testing the **previous task's output**; no-code editor in the Builder task inspector ("Run condition" select + value, hidden for the first task), IF badge in the task list, GitFork icon + "task · conditional/skipped" label on canvas nodes. The adapter validates (not first task, not async) with friendly errors; the exporter emits a `_condition` predicate + `ConditionalTask`. The runner's `condition_observer` emits `task.skipped` AND resyncs `task_idx` — crewai fires **no task event at all** for a skipped task, which would otherwise desync canvas/timeline correlation.
- **Built-in tool config + live execution** (`server/builtin_tools.py`): introspects crewai_tools classes (simple pydantic params + `EnvVar` requirements), per-tool config in settings (env encrypted at rest, masked `•••` in responses, masked re-save keeps the secret); live runs instantiate configured built-ins referenced by agent.tools/spec.skills (missing key → `tool.config.error` event, not fatal); Tools page has needs-key/ready badges + a Configure modal; the exporter now actually instantiates built-in tools in generated code (args in `config/tools.yaml`, keys env-only, never exported).
- **Cost (est. $)** (`server/pricing.py`): curated per-1M-token price table (litellm is no longer a crewai dep, so no free pricing data) with longest-prefix model matching; the runner splits prompt/completion tokens per LLM call and accumulates `run.cost`; shown as "$… est." in the Runs header + `run.finished` timeline row, and as an "est. spend" Dashboard stat. Unknown models show no cost rather than a wrong one.
- **Scheduling + webhook triggers** (`server/schedules.py`, croniter dep): cron schedules per workspace (CRUD via `/api/schedules`, `schedules` table) executed by an in-process daemon thread (15s tick; due schedules advance `next_run_at` BEFORE starting so a crash can't hot-loop; busy workspace → skip tick; deleted workspace → schedule auto-disabled; run uses the workspace's current spec + run-input defaults merged with schedule-pinned inputs). Webhook: `ws.hook_token` (spec field — the Builder generates/rotates it client-side via `mutate` so autosave can't clobber it; server endpoints `POST/DELETE /api/workspaces/{id}/hook` also exist) → public `POST /api/hooks/{ws_id}/{token}` with optional `{inputs, dry_run}` body. Runs carry `trigger` (manual | webhook | schedule:<id>), badged in the Runs header. Builder gained a "Triggers" card (cron presets + custom, pause/resume/delete, webhook URL copy/rotate/disable).

- **Batch runs** (`server/batches.py`): run one workflow over many input rows (crewai's `kickoff_for_each`, but each row is a **first-class tracked run** — own timeline, canvas, cost, replay — not one opaque combined output). A daemon driver runs the rows **sequentially** through the shared RunManager (no rate-limit pileups; same philosophy as the scheduler), folding each finished run's status/cost/tokens into the batch record (`finished/succeeded/failed`, aggregate `cost`/`tokens`, status running → done|cancelled). Runs carry `trigger="batch:<id>"` + `batch_id`/`batch_index`. CSV→rows parse (`rows_from_csv`: header names the inputs, unknown columns dropped, blank rows skipped) so you can paste straight from a spreadsheet. API: `POST /api/batches` (`{workspace_id, csv|rows, dry_run, name?}`), `GET /api/batches[?workspace_id=]`, `GET /api/batches/{id}` (embeds its runs), `POST /api/batches/{id}/cancel` (stops remaining rows + cancels the in-flight run). Builder has a **Batch** button (shown when the workflow defines inputs) → CSV paste dialog; the Runs page groups a batch into a progress card (`?batch=<id>`) with per-row tiles that open each run.

- **Quality & evaluation suite** (`server/evals.py`): run a workflow over a saved **test set** and score each output. A *case* = run inputs + a list of *checks*; checks are `contains` / `not_contains` / `equals` / `regex` (deterministic, work in dry-run) plus **`judge`** — LLM-as-judge that asks the configured model whether the output meets a plain-language criterion (the only check needing a live provider; in dry-run it fails cleanly with "needs a live model"). `score_output()` is a pure, fully-unit-tested function (a case passes iff every check passes; a case with no checks just runs). A sequential driver (same pattern as batches) runs each case as a tracked run (`trigger="eval:<id>"`), scores it, and folds pass/fail into the eval record (`passed`/`failed`/`score` = pass-rate, aggregate cost/tokens). The test set persists on the spec (`ws.eval_cases`) so it versions with the workflow and re-runs anytime (regression testing). API: `POST /api/evals/run` (uses request `cases` else `ws.eval_cases`), `GET /api/evals[?workspace_id]`, `GET /api/evals/{id}`, `POST /api/evals/{id}/cancel`. Builder has a **Tests** card (define cases: inputs + checks, stacked for the narrow inspector); a **Run tests** button → the Runs page shows an **eval panel** (`?eval=<id>`) with a pass-rate badge, per-case pass/fail, per-check ✓/✗ (judge detail on hover), and drill-in to each case's run.

Commit history on `main` tells the phase-by-phase story (Phases 0–7 + follow-ups).

---

## ✅ No work in flight
The multi-LLM frontend shipped in `9328d5d`: Settings is a connection list
(add/edit/delete/set-default), Builder has a workflow LLM select (`ws.llm_id`) and
per-agent selects (`agent.llm_id`). The legacy `/api/settings/llm*` compat shims and
the `getLlm`/`saveLlm`/`LlmSettings` client API are **gone** — `Dashboard.tsx` now
derives its "active model" stat from `api.llms()` (the default connection). The only
LLM endpoints are `/api/llms*` (`/models`, `/test`, `/default`).

**Live MiniMax verification complete** (2026-06-11): single run ("The capital of France is Paris.", 108 tokens, $0.000028), and a 3-case eval with judge checks (100% pass, $0.000084, `PASS/FAIL` parsing confirmed). Every page has been browser-verified (Playwright) with **zero console errors**, incl. the full batch lifecycle (launch → grouped Runs view → per-row drill-in) on desktop + mobile.

One remaining gap: a truly **multi-provider** run (each agent pinned to a different LLM connection) hasn't been exercised with real keys, but the wiring (`spec → llms.resolve(agent.llm_id)`) is unit-covered.

---

## Known gotchas (will bite you)
- **HITL gates now block in every mode** (incl. dry-run): a `human_input` task pauses the run until you decide in the Run console (or `POST /api/runs/{id}/input`). A walked-away run stays `running` — use Stop. Tests answer gates programmatically via `RunManager.hitl_decision`.
- **Cancellation is cooperative**: it lands at the next `llm.call` or HITL wait. A run stuck inside a single long provider call won't die until that call returns.
- **`_public()` strips `_`-prefixed run-record keys** — keep thread primitives (`_cancel`, `_hitl_evt`, …) underscore-prefixed or JSON serialization of runs breaks.
- **MiniMax**: use base URL `https://api.minimaxi.chat/v1` and model `MiniMax-Text-01` (or other MiniMax model names). The `api.minimax.chat` domain returns 401; the `api.minimaxi.chat` OpenAI-compat endpoint is the working one. **Verified live** (2026-06-11): connection test, single run, and eval judge all passed.
- **Dry-run gating**: planning, memory, `output_pydantic` only activate live (the `FakeLLM` can't do structured output / embeddings). Don't "fix" dry-run to enable them.
- **fastembed** downloads `BAAI/bge-small-en-v1.5` (~130MB) on first embed; cached after. Knowledge vector search is keyless; **graph extraction needs a provider** (Build graph errors cleanly without one).
- **Schedules fire only while the server runs** (in-process thread, no catch-up for missed windows) and evaluate cron in server-local time. The webhook token is a capability URL — anyone holding it can start runs; rotate from the Builder Triggers card.
- **Kuzu graphs** live under `knowledge_graphs/<kb_id>` next to the DB (gitignored). Kuzu locks a DB **per process** — `graph.py` caches Database handles and serializes writes; don't open the same KB graph from a second process while the server is running. The build is **explicit** (button/POST), incremental (only ungraphed chunks), and a per-chunk parse failure is skipped, not fatal.
- A "Phase 3 demo" KB (`kb-05c6f862`, Northwind Robotics) is seeded in the local DB with a hand-built graph for demoing the viz/hybrid search — delete from the Knowledge page if unwanted. **Live LLM extraction has not been run with a real key** (only stub-tested); first real build will verify `extract.py` prompt quality.
- **MCP stdio** servers (npx/uvx) can hang on cold start in sandboxes — connection path is correct; remote URL servers are more reliable to test.
- **Built-in tools** now execute live once configured (Tools → Configure). `pricing.py` figures are **estimates** from a curated table — update `PRICES` as providers reprice; unknown models intentionally show no cost.
- **Batch/eval + HITL don't mix**: batches and evals run cases unattended, but a `human_input` task still **blocks** every case at its gate (gates block in all modes) — so the run hangs on case 0 until you answer it in the Run console (or Stop the batch/eval). Don't batch/eval a workflow that has human-input tasks. Both drivers are **sequential** by design (one case finishes before the next starts) — a hung case stalls the whole run.
- **Eval `judge` checks are live-only**: the LLM-as-judge scorer needs a configured provider; in dry-run (or with no default model) a `judge` check fails with detail "needs a live model" rather than erroring. The deterministic checks (`contains`/`not_contains`/`equals`/`regex`) work in any mode. `_judge()` parses a leading `PASS`/`FAIL` from the model reply — **verified live against MiniMax** (2026-06-11): 3 cases, 3 judge checks, all correctly parsed and scored.
- **Conditional tasks**: a condition tests the output of the **immediately preceding** task only, and a skipped task's output is **empty** — chained conditionals after a skip see "" (so `contains` fails, `not_contains` passes). crewai fires no task event for a skipped task; the runner's `condition_observer` is what emits `task.skipped` and keeps `task_idx` in sync — don't remove it.
- **crewai event handlers** run on a thread pool → correlate via closures over the run record, not thread-locals (see `runner.py`).
- `crewforge.db*` and `secret.key` are gitignored (runtime state; DB re-seeds on boot).

---

## Near-term (small, ready to pick up)
1. **~~Live multi-provider verification~~** ✅ *Done (MiniMax, 2026-06-11)*. Single run + 3-case eval with judge checks all passed. Remaining: MCP + built-in tools live exercise, planning/memory live (needs embedder key), Build graph with a real `extract.py` run.
2. **Onboarding tour** — a first-run guided walkthrough (build → dry-run → observe → go live). Low risk, high "first 5 minutes" payoff. The empty states already point the way; a tour stitches them.
3. **Inline MCP marketplace drawer in Builder** — today adding an integration means leaving for the Tools page; a slide-over drawer (reuse `registry.search` + the Tools connect flow) lets you add + attach without losing canvas context.

## Next larger phases (ordered by product value)
1. **Eval suite — round 2** (the core shipped; `server/evals.py`). (a) ~~verify LLM-as-judge live~~ ✅ *Done (MiniMax, 2026-06-11)*; (b) eval **history & trend** (score over time per workflow — the records already persist); (c) the human-feedback **`train()`** loop (capture preference data over N iterations); (d) richer scorers (JSON-path / numeric tolerance / semantic similarity).
2. **CrewAI Flows / multi-crew orchestration**. Today a workspace = one crew. Flows are CrewAI's event-driven layer: chain crews, branch on outputs (`@router`), loop, fan-out. A second canvas type ("Flow") that wires crews together is the biggest product expansion — the jump from "a team" to "a pipeline of teams". Large: new spec model, new exporter path, new run semantics.
3. **Run history & analytics**. The data exists (runs carry status/tokens/cost/trigger; batches and evals roll up cost + pass-rate). Build a reporting layer: cost-over-time, success-rate, token trends, per-workflow/per-batch/per-eval rollups, slowest tasks. Pairs with eval history (#1) for tracking quality over time.
4. **Versioning & diff**. Workspace version snapshots, visual diff between versions, rollback — then "compare v1 vs v2 on the same eval set" closes the loop with the eval suite.
5. **Durability & scale** (only if outgrowing single-user-local). Run/batch/eval execution is in-process threads + SQLite; a crash loses in-flight work and the scheduler has no missed-window catch-up. Phase: move execution to a worker queue (RQ/Celery), optional Postgres backend, durable/replayed schedules. Pairs with a **multi-user** fork (auth, per-user workspaces, RBAC) — note this changes the security posture (today the webhook token is the only auth surface).
6. **Deployment targets** beyond the zip export: one-click Docker image of a generated crew, scheduled cloud run, or CrewAI Enterprise push. The exporter already emits a clean, runnable project — packaging is the remaining step.

## References
- Full design + phase history: `/Users/arthur/.claude/plans/system-design-see-the-crew-cheerful-lake.md` (PLAN v4 section = knowledge graph + this roadmap).
- crewai **1.14.6**, Python **3.12** pinned.
