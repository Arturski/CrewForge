# CrewForge Roadmap

CrewForge is a no-code studio for [CrewAI](https://github.com/crewAIInc/crewAI):
design, run, and observe agentic workflows, then export a portable CrewAI project.

## Shipped

- ✅ **Compatibility engine** — introspects the installed `crewai` (136 fields) so the UI tracks new releases automatically.
- ✅ **Workflow studio** — create workflows; add/edit/delete agents & tasks; **simple, tooltip-explained** agent config with the full schema behind progressive disclosure.
- ✅ **Per-task strict rules** compiled into reasoning constraints.
- ✅ **Live observability** — runs stream the CrewAI event lifecycle over SSE; persisted history.
- ✅ **Dry-run mode** — try everything with no API key (built-in mock LLM).
- ✅ **Models** — configure LLM provider/model/key (LiteLLM-style) for live runs.
- ✅ **Skills catalog** — 103 built-in CrewAI tools, searchable; attach to agents.
- ✅ **Code export** — download a runnable, idiomatic CrewAI project (no lock-in).
- ✅ **One-command launcher** — `crewforge` starts the server and opens the studio.
- ✅ Persistence (SQLite), Apache-2.0, CI, tests.

## Next

- 🔜 **Open skill marketplace (MCP)** — browse the official/Glama MCP registries, security ratings via `mcp-scan` + hash-pinning, add skills from GitHub/npm/URL, run via `MCPServerAdapter`. Skills transferable across agents.
- 🔜 **Memory** — configure short-term / long-term / entity / external memory per crew.
- 🔜 **Data sources (knowledge)** — ingest files/URLs/PDF/CSV as agent or crew knowledge with embeddings.
- 🔜 **Agent persona library** — a curated set of detailed, reusable personas.
- 🔜 **Live skill execution** in runs (currently exported, not yet executed).

## Later

- Visual flow builder (`@router`/`@listen`, branching, parallel paths).
- Containerized run workers; encrypted secret vault.
- Tauri desktop app (zero-dependency install).
- Train/test, replay/fork, token & cost analytics.
- Multi-tenant / hosted mode.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
