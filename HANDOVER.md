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
uv run --extra dev pytest -q          # 8 tests, no network/model download
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
- `knowledge/` — `vector.py` (fastembed local embeddings + chunk + cosine), `kb.py` (CRUD + background ingest of text/pdf/docx/md/txt/csv). `providers.py` — live model-list fetch per provider.
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

Commit history on `main` tells the phase-by-phase story (Phases 0–5 + follow-ups).

---

## ⚠️ IN-FLIGHT — finish this first (multiple LLM connections)
Backend is DONE and on `main` (`901e576`); the **frontend is NOT**. Today the Models page still edits the *single default* connection via compat shims (`/api/settings/llm*`), which works. To deliver true multi-LLM:

**Goal (user's words):** "select per workflow and per agent from the list of LLMs I have configured."

**Backend already provides** (use these):
- `GET /api/llms` → `{ llms: [{id,name,model,base_url,temperature,api_key_set}], default }`
- `POST /api/llms` (upsert: omit `id` to create) · `DELETE /api/llms/{id}` · `PUT /api/llms/default {id}`
- `POST /api/llms/test` (`{id}` or inline `{model,base_url,api_key}`) · `POST /api/llms/models` (live model list)
- Runner already resolves `spec.llm_id` (workflow) and `agent.llm_id` (per-agent) from the list.

**Frontend TODO:**
1. `web/src/lib/api.ts` — add `llms()`, `saveLlm2(cfg)`→POST /api/llms, `deleteLlm(id)`, `setDefaultLlm(id)`, repoint `testLlm`/`providerModels` to `/api/llms/*`. Add `LlmConfig` type.
2. `web/src/pages/Settings.tsx` — rebuild as a **list of connections** (cards: name, model, default badge; add/edit via the existing provider form; delete; set-default). Reuse the provider preset + Refresh + Test logic that's already there.
3. `web/src/pages/Builder.tsx` — add a **workflow LLM select** (Workflow settings card → `ws.llm_id`) and replace the agent "Model (optional)" free-text with a **per-agent LLM select** (`agent.llm_id`, options = "Use workflow default" + configured connections). Model chip shows the resolved default name.
4. Remove the legacy `/api/settings/llm*` compat shims from `app.py` once the UI no longer calls them (optional cleanup).
Verify: configure 2 connections, set one default, override one agent to the other, run live, confirm each agent uses its model.

---

## Known gotchas (will bite you)
- **MiniMax**: use `hosted_vllm/<model>` + base `https://api.minimax.io/v1` (crewai rejects `openai/`/`anthropic/` for non-native model names; only `hosted_vllm` passes). MiniMax has **no `/models` endpoint** (Refresh hidden). The user still needs to confirm a live chat works with their key (Test connection) — if MiniMax's OpenAI-compatible `/v1` rejects the key, may need a MiniMax-native path.
- **Dry-run gating**: planning, memory, `output_pydantic` only activate live (the `FakeLLM` can't do structured output / embeddings). Don't "fix" dry-run to enable them.
- **fastembed** downloads `BAAI/bge-small-en-v1.5` (~130MB) on first embed; cached after. Knowledge vector search is keyless; **graph extraction (Phase 3) will need a provider**.
- **MCP stdio** servers (npx/uvx) can hang on cold start in sandboxes — connection path is correct; remote URL servers are more reliable to test.
- **Built-in tools** are catalogued + exported but **not instantiated for live runs** (most need keys/args). Only **MCP** tools and **knowledge** tools execute live today.
- **crewai event handlers** run on a thread pool → correlate via closures over the run record, not thread-locals (see `runner.py`).
- `crewforge.db*` and `secret.key` are gitignored (runtime state; DB re-seeds on boot).

---

## Remaining roadmap (priority order)
1. **Finish multi-LLM frontend** (above) — immediate.
2. **Knowledge Phase 2** — web page / docs-site crawl + GitHub repo ingestion + background-job progress UI (`server/knowledge/jobs.py`, sources already have status).
3. **Knowledge Phase 3** — **Kuzu** graph layer: LLM entity/relation extraction → embedded graph, hybrid retrieval, graph viz (XyFlow). Needs `kuzu` dep + a provider for extraction.
4. **Stop/cancel a running run** + **live HITL** (real approve/edit prompt in the Run console; today the guardrail gate auto-approves).
5. **Task-dependency edges on the canvas** → `task.context`; expose conditional tasks. **Hierarchical manager** selection UI.
6. **Built-in tool config + live execution**; **replay/fork/duplicate**; **cost ($)** from tokens×pricing.
7. **Scheduling/triggers** (cron/webhook); **train()/test()/batch**.
8. Polish: inline marketplace drawer in Builder, encrypt MCP env secrets, final a11y/contrast/touch pass, onboarding tour.

## References
- Full design + phase history: `/Users/arthur/.claude/plans/system-design-see-the-crew-cheerful-lake.md` (PLAN v4 section = knowledge graph + this roadmap).
- crewai **1.14.6**, Python **3.12** pinned.
