# Contributing to CrewForge

Thanks for your interest in contributing! CrewForge is an open-source (Apache-2.0) no-code studio for [CrewAI](https://github.com/crewAIInc/crewAI).

---

## Quick contributor setup

```bash
git clone https://github.com/Arturski/CrewForge.git
cd CrewForge

# Python deps (includes dev extras: pytest, ruff)
uv sync --extra dev

# Node deps + build
npm --prefix web install
npm --prefix web run build

# Verify everything passes before you start
uv run --extra dev pytest -q        # 52 tests, ~5s
uv run --extra dev ruff check server tests
npm --prefix web run build          # tsc strict
```

For development with hot reload:

```bash
# Terminal 1 — API
uv run uvicorn server.app:app --reload --port 8765

# Terminal 2 — Vite
npm --prefix web run dev  # → http://localhost:5180
```

---

## Project shape

```
server/                 Python / FastAPI backend
  app.py                All REST + SSE endpoints (~50 routes)
  store.py              SQLite persistence (all CRUD)
  runner.py             Run execution + CrewAI event capture
  compiler/
    manifest.py         ← the compatibility core (see below)
    adapter.py          Spec → live Crew/Agent/Task objects
    exporter.py         Spec → runnable CrewAI project zip
    tools.py            103 built-in crewai_tools catalog
  knowledge/            Vector RAG + Kuzu graph layer
  batches.py            Batch runner (CSV → N tracked runs)
  evals.py              Eval suite + LLM-as-judge scoring
  schedules.py          Cron daemon + webhook trigger handler
  llms.py               Multi-LLM connection management
  secrets.py            Fernet encryption at rest

web/src/
  pages/                React pages (Dashboard, Builder, Runs, Tools, Knowledge, Settings, Code)
  components/           Shared components (CrewCanvas, EventTimeline, ui.tsx, Sidebar)
  lib/api.ts            Typed API client — the contract between front and back

tests/                  52 pytest unit tests (no network, no key)
docs/                   Documentation + architecture diagrams
```

---

## The compatibility core

`server/compiler/manifest.py` introspects the installed `crewai` package to build a field manifest that drives the Builder's forms. **This is why CrewForge tracks new CrewAI releases automatically** — you rarely need to change code when CrewAI adds a field.

The rule:

- **Attribute-level additions** (new scalar/bool/enum field on `Agent`, `Task`, or `Crew`) → nothing to do. The manifest picks them up; the Builder's "Advanced" panel renders them.
- **Structural additions** (new process type, memory backend, flow decorator, output type) → need code in `compiler/adapter.py` (and `exporter.py`) plus a Builder UI affordance if they're not plain scalars.

---

## Adding a feature

### New CrewAI attribute

1. Verify: `uv run python -c "from server.compiler.manifest import build; import json; print(json.dumps(build()['models']['Agent'], indent=2))"` — check the field already appears.
2. If it does — you're done. Test it in the Builder "Advanced" panel.
3. If not, it's a complex type not yet mapped. Add a case in `manifest.py`'s type resolver.

### New structural CrewAI feature (e.g. a new process type)

1. Add the mapping in `compiler/adapter.py` (spec field → CrewAI object construction).
2. Update `compiler/exporter.py` to emit it in the generated project.
3. Add a UI control in the relevant Builder card if it's not a plain field.
4. Add a test in `tests/`.

### New backend feature (batch type, eval check type, etc.)

1. Add server logic in the appropriate module.
2. Add the endpoint(s) in `server/app.py`.
3. Add typed client methods in `web/src/lib/api.ts`.
4. Add the UI in the appropriate page.
5. Add tests.

### New page or major UI feature

- Follow the existing page pattern: lazy-loaded route in `web/src/main.tsx`, typed API calls via `lib/api.ts`, Radix-backed primitives from `components/ui.tsx`.
- Use Tailwind v4 CSS variables (`--color-elevated`, `--color-text-secondary`, etc.) rather than raw hex colors.

---

## Code conventions

### Python

- Type hints on all public functions.
- `ruff` for linting and import sorting (`uv run --extra dev ruff check --fix server tests`).
- Line length: 100 (ruff enforces).
- Comments only for non-obvious *why* — never describe what the code does.
- Keep `manifest.py` generic — avoid hardcoding crewai field names where introspection can discover them.
- Keys in settings/store are always encrypted via `secrets.enc()` before writing; decrypted only at call time.

### TypeScript / React

- `lib/api.ts` is the contract. Every API response has a typed interface; no `any`.
- Components use the primitives in `components/ui.tsx` — don't import Radix directly in pages.
- State: local `useState`/`useReducer` for UI state; manual polling with `setInterval` + `useState` for server state.
- No CSS files — Tailwind v4 utility classes only.

### Tests

- All tests in `tests/`. No test logic in `server/`.
- All tests run with `uv run --extra dev pytest -q` — no network, no API key, no model download.
- Use `_StubRuns` (stub RunManager) and `store.init()` (in-memory SQLite) as the standard test doubles.
- New check types in `evals.py` need a case in `tests/test_evals.py::test_score_output_assertion_checks`.

---

## Quality gates (all must pass before merging)

```bash
uv run --extra dev ruff check server tests
uv run --extra dev pytest -q
npm --prefix web run build
```

Browser-verify new features with zero console errors before marking a PR ready.

---

## Commit style

```
Short imperative summary (≤72 chars)

Optional body explaining why, not what.
```

---

## Opening a PR

- **Bug fixes and small improvements** — open a PR directly.
- **New features or architectural changes** — open an issue first to discuss the design.
- Keep PRs focused on one thing.

---

## Reporting issues

- **Bug reports**: include the CrewForge version (`GET /api/health`), Python version, OS, and steps to reproduce.
- **Security vulnerabilities**: use [GitHub Security Advisories](https://github.com/Arturski/CrewForge/security/advisories/new) rather than a public issue. See [SECURITY.md](SECURITY.md).
