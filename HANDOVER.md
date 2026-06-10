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
uv run --extra dev pytest -q          # 24 tests, no network/model download
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

Commit history on `main` tells the phase-by-phase story (Phases 0–5 + follow-ups).

---

## ✅ No work in flight
The multi-LLM frontend (formerly the in-flight item) shipped in `9328d5d`: Settings is a
connection list (add/edit/delete/set-default), Builder has a workflow LLM select
(`ws.llm_id`) and per-agent selects (`agent.llm_id`). The legacy `/api/settings/llm*`
compat shims remain only because `Dashboard.tsx` still calls `getLlm()` for its
"active model" stat — migrate that, then delete the shims.

One unverified path: a **live** multi-provider run (each agent on its own provider)
has not been executed with real keys; the wiring (spec → `llms.build`) is test-covered.

---

## Known gotchas (will bite you)
- **HITL gates now block in every mode** (incl. dry-run): a `human_input` task pauses the run until you decide in the Run console (or `POST /api/runs/{id}/input`). A walked-away run stays `running` — use Stop. Tests answer gates programmatically via `RunManager.hitl_decision`.
- **Cancellation is cooperative**: it lands at the next `llm.call` or HITL wait. A run stuck inside a single long provider call won't die until that call returns.
- **`_public()` strips `_`-prefixed run-record keys** — keep thread primitives (`_cancel`, `_hitl_evt`, …) underscore-prefixed or JSON serialization of runs breaks.
- **MiniMax**: use `hosted_vllm/<model>` + base `https://api.minimax.io/v1` (crewai rejects `openai/`/`anthropic/` for non-native model names; only `hosted_vllm` passes). MiniMax has **no `/models` endpoint** (Refresh hidden). The user still needs to confirm a live chat works with their key (Test connection) — if MiniMax's OpenAI-compatible `/v1` rejects the key, may need a MiniMax-native path.
- **Dry-run gating**: planning, memory, `output_pydantic` only activate live (the `FakeLLM` can't do structured output / embeddings). Don't "fix" dry-run to enable them.
- **fastembed** downloads `BAAI/bge-small-en-v1.5` (~130MB) on first embed; cached after. Knowledge vector search is keyless; **graph extraction needs a provider** (Build graph errors cleanly without one).
- **Kuzu graphs** live under `knowledge_graphs/<kb_id>` next to the DB (gitignored). Kuzu locks a DB **per process** — `graph.py` caches Database handles and serializes writes; don't open the same KB graph from a second process while the server is running. The build is **explicit** (button/POST), incremental (only ungraphed chunks), and a per-chunk parse failure is skipped, not fatal.
- A "Phase 3 demo" KB (`kb-05c6f862`, Northwind Robotics) is seeded in the local DB with a hand-built graph for demoing the viz/hybrid search — delete from the Knowledge page if unwanted. **Live LLM extraction has not been run with a real key** (only stub-tested); first real build will verify `extract.py` prompt quality.
- **MCP stdio** servers (npx/uvx) can hang on cold start in sandboxes — connection path is correct; remote URL servers are more reliable to test.
- **Built-in tools** are catalogued + exported but **not instantiated for live runs** (most need keys/args). Only **MCP** tools and **knowledge** tools execute live today.
- **crewai event handlers** run on a thread pool → correlate via closures over the run record, not thread-locals (see `runner.py`).
- `crewforge.db*` and `secret.key` are gitignored (runtime state; DB re-seeds on boot).

---

## Remaining roadmap (priority order)
1. **Conditional tasks** (deferred from the task-dependency phase — needs a no-code condition builder design).
2. **Built-in tool config + live execution** (catalogued + exported today, but not instantiated for live runs); **cost ($)** from tokens×pricing.
3. **Scheduling/triggers** (cron/webhook); **train()/test()/batch**.
4. Polish: inline marketplace drawer in Builder, final a11y/contrast/touch pass, onboarding tour; migrate Dashboard off `getLlm()` and delete the `/api/settings/llm*` shims.
5. Verify a **live multi-provider run** end-to-end with real keys (multi-LLM, MCP tools, planning/memory, a real graph build) — everything is wired and stub/dry-run-tested, but no real provider call has been made this cycle.

## References
- Full design + phase history: `/Users/arthur/.claude/plans/system-design-see-the-crew-cheerful-lake.md` (PLAN v4 section = knowledge graph + this roadmap).
- crewai **1.14.6**, Python **3.12** pinned.
