# Contributing to CrewForge

Thanks for your interest! CrewForge is an open-source (Apache-2.0) no-code studio for CrewAI.

## Project shape

- `server/` — FastAPI control plane.
  - `compiler/manifest.py` — introspects the installed `crewai` into a UI manifest. **This is the compatibility core**: the UI renders forms from it, so new crewai fields appear automatically.
  - `compiler/adapter.py` — turns a workspace spec into live CrewAI objects.
  - `runner.py` — executes runs and captures crewai events for live observability.
- `web/` — React + Vite + Tailwind UI.
- `spikes/` — throwaway proofs of the architecture (see `SPIKE_FINDINGS.md`).

## Dev setup

```bash
uv sync
npm --prefix web install
# API:  uv run uvicorn server.app:app --reload --port 8765
# UI :  npm --prefix web run dev
```

## Adding support for a CrewAI feature

Most **attribute-level** features need no work — they surface automatically via the manifest.
**Structural** features (a new process type, flow decorator, memory backend) need:
1. a mapping in `compiler/adapter.py` (and the exporter, once it lands), and
2. a builder UI affordance if it isn't a plain field.

## Conventions

- Python: type hints, `ruff` formatting. Keep the manifest generic — avoid hardcoding crewai field names.
- Pin/verify against the supported `crewai` version range; note version-specific behavior (e.g. the HITL finding in `SPIKE_FINDINGS.md`).
- Open an issue to discuss larger changes before a PR.
