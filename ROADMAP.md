# CrewForge Roadmap

CrewForge is a self-hosted, open-source visual studio for [CrewAI](https://github.com/crewAIInc/crewAI): design multi-agent workflows in the browser, run them with live observability, and export clean Python you own.

---

## ✅ Shipped

### Core studio
- **Visual workflow builder** — drag-and-drop canvas; add/edit/delete agents & tasks; inline config + full "Advanced" panel driven by the manifest
- **Compatibility engine** — `compiler/manifest.py` introspects the installed `crewai` (~136 fields) so the UI tracks new releases automatically
- **Dry-run mode** — `FakeLLM` mock; every feature works with no API key
- **Live observability** — SSE event stream; timeline with durations, tokens, tool I/O, errors; canvas glows per run
- **Code export** — download a complete, runnable CrewAI project (no lock-in)
- **One-command launcher** — `crewforge` starts the server and opens the studio

### Agents & tasks
- **Hierarchical process** — manager agent or auto LLM manager
- **Planning** (live runs) — crew plans before executing
- **Memory** (live runs) — short/long-term crew memory
- **Structured outputs** — `output_pydantic` per task
- **Async tasks** and **conditional tasks** (`ConditionalTask` with IF badge on canvas)
- **Task dependencies** — context edges on the canvas
- **Per-agent scalar fields** — all manifest-discovered fields in the Advanced panel

### Tools & integrations
- **103 built-in tools** — searchable catalog; per-tool API key config (encrypted); ready/needs-key badges
- **MCP integrations** — connect stdio/SSE/HTTP servers; official registry search + security ratings

### Knowledge
- **Vector RAG** — keyless fastembed (`bge-small-en-v1.5`); ingest text, files, URLs, GitHub repos
- **Knowledge graph** — per-KB Kuzu graph; LLM entity/relation extraction; hybrid retrieval; XyFlow preview
- **`search_<kb>` tool** — auto-generated and attachable to agents/workflows

### LLMs & secrets
- **Multi-LLM connections** — named connection list; per-workflow + per-agent LLM select
- **Any OpenAI-compatible provider** — presets + custom base URL
- **Secrets vault** — Fernet encryption at rest; keys never returned to client
- **Cost tracking** — per-run estimated USD; timeline + dashboard stat

### Runs & operations
- **Stop/cancel**, **HITL** (approve / edit / reject mid-run), **Replay**, **Duplicate**
- **Scheduling** — cron schedules; in-process daemon; per-schedule input pinning
- **Webhook triggers** — `POST /api/hooks/{id}/{token}`
- **Batch runs** — CSV → one tracked run per row; aggregate cost; cancel propagates
- **Evaluation suite** — test cases with `contains`/`not_contains`/`equals`/`regex`/`judge` checks; LLM-as-judge; pass-rate panel; test set persists on spec

### Polish
- Responsive sidebar, mobile viewport verified
- ARIA progressbars, accessible controls throughout
- Route code-splitting, persona library, starter templates
- 52 pytest tests (no network); ruff + tsc CI

---

## 🔜 Near-term

1. **Eval history & trend** — pass-rate and cost over time per workflow (records already persist; needs a reporting view)
2. **Onboarding tour** — first-run guided walkthrough: build → dry-run → observe → go live
3. **Inline MCP marketplace drawer** — add + attach an MCP server without leaving the Builder canvas

---

## 🔭 Larger phases

### 1. CrewAI Flows / multi-crew orchestration
Today a workspace = one crew. Flows are CrewAI's event-driven layer: chain crews, branch on outputs (`@router`), loop, fan-out. A "Flow" canvas type wiring crews together is the biggest product expansion.

### 2. Run history & analytics
Cost-over-time, success-rate, token trends, per-workflow/per-batch/per-eval rollups, slowest tasks. The data exists; this is a reporting layer.

### 3. Workspace versioning & diff
Version snapshots, visual diff, rollback — then "compare v1 vs v2 on the same eval set."

### 4. Durability & scale
Optional worker queue (RQ/Celery) + Postgres backend for crash-safe execution and missed-window catch-up. Pairs with multi-user auth (RBAC, per-user workspaces).

### 5. Deployment targets
One-click Docker image of a generated crew, scheduled cloud run, or CrewAI Enterprise push.

---

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
