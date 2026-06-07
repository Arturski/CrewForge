# CrewForge

**A no-code studio for [CrewAI](https://github.com/crewAIInc/crewAI).** Visually design,
configure, run, control, and observe agent / crew / flow workflows — then export a portable,
idiomatic CrewAI project with **no lock-in**.

> Status: **early development.** Architecture validated by spikes (see
> [`spikes/SPIKE_FINDINGS.md`](spikes/SPIKE_FINDINGS.md)); core product being built. Not yet usable.

## Why

CrewAI is a powerful code-first framework. CrewForge gives it a visual front door: build workflows
in the browser, run them with live observability, and own the generated code. Self-hosted and
open-source (Apache-2.0).

## How it stays compatible with CrewAI

CrewForge does not hardcode CrewAI's API. It **introspects the installed `crewai`** to build a
capability manifest that drives the UI dynamically — so new CrewAI fields surface as new controls
with no code changes. Workflows are stored as a declarative spec that a single translation layer
turns into **live CrewAI objects** (to run) and an **exported CrewAI project** (to keep). See the
[design doc](docs/) for details.

## Architecture (validated)

- **Compatibility engine** — generic Pydantic-model introspection → 136 configurable fields across Agent/Task/Crew discovered automatically. New fields map to UI controls with zero code change.
- **Run loop** — `spec → adapter → Crew → kickoff()` with a `BaseEventListener` streaming the full event lifecycle for live observability.
- **HITL** — modeled as task **guardrail gates** the worker owns (a long-poll point), not CrewAI's native `human_input`.

## Stack

Python 3.12 · FastAPI · Postgres · React + TypeScript + Vite · shadcn/ui + Tailwind · XyFlow ·
containerized run workers.

## Quickstart (preview)

```bash
# 1. backend deps (Python 3.12 pinned via uv)
uv sync

# 2. build the web UI
npm --prefix web install && npm --prefix web run build

# 3. run — serves API + UI on one port
uv run uvicorn server.app:app --port 8765
# open http://localhost:8765
```

No API key needed: runs default to **dry-run** mode using a built-in mock LLM, so you
can build a crew, run it, and watch live events stream in immediately.

### Dev mode (hot reload)

```bash
# terminal 1 — API
uv run uvicorn server.app:app --reload --port 8765
# terminal 2 — Vite dev server (proxies /api -> :8765)
npm --prefix web run dev          # http://localhost:5180
```

## What's here (P0)

- **Compatibility engine** — `server/compiler/manifest.py` introspects crewai → 136 fields; the UI renders forms from it.
- **Adapter + run loop** — `server/compiler/adapter.py` + `server/runner.py`: spec → `Crew` → `kickoff()` with a `BaseEventListener` capturing the lifecycle; HITL via guardrail gate.
- **Control plane** — `server/app.py` (FastAPI): manifest, workspaces, runs, SSE event stream, SPA host.
- **UI** — `web/` (React 19 + Vite + Tailwind v4): Dashboard, Builder (manifest-driven Agent form), Runs (live SSE timeline).

## Spikes (architecture proofs)

```bash
uv run python spikes/spike_a_manifest/introspect.py   # compatibility engine
uv run python spikes/spike_b_runloop/run.py           # run loop + events + HITL
```
See [`spikes/SPIKE_FINDINGS.md`](spikes/SPIKE_FINDINGS.md).

## License

[Apache-2.0](LICENSE).
