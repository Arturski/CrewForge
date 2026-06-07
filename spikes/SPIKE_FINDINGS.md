# CrewForge — Spike Findings (Stage 1 de-risking)

Environment: macOS, `uv`-managed venv, **Python 3.12** (crewai targets 3.10–3.13; system 3.14 is too new), **crewai 1.14.6**. No Docker / no LLM keys used.

## Spike A — Compatibility engine (manifest introspection) → **PASS** ✅

`spikes/spike_a_manifest/introspect.py`

- Generic introspection of `Agent`/`Task`/`Crew` Pydantic models discovered **136 configurable fields** (Agent 60, Task 36, Crew 40) with **zero per-field code**.
- Type→control mapping verified: `role`→text, `backstory`→textarea, `verbose`→toggle, `max_iter`→number, `tools`→list, `llm`→`json` (escape hatch).
- **Decisive proof:** a synthetic "future crewai" model with new fields (`confidence_threshold`→number, `guardrail_policy`→select-with-options, `new_secret_flag`→toggle) mapped to controls automatically — **no introspector changes**.
- **Conclusion:** compatibility-by-introspection holds. Attribute-level CrewAI features will surface in the UI on manifest regeneration. The `json` escape-hatch guarantees no field is ever un-configurable, even before a bespoke control exists.

→ Promote `introspect.py` to `server/compiler/manifest.py` in P0.

## Spike B — Run loop (adapter → events → HITL) → **PASS** ✅

`spikes/spike_b_runloop/run.py`

- `spec → build_crew() → kickoff()` ran a 2-agent sequential crew on a **zero-cost `FakeLLM`** (subclass of `crewai.llms.base_llm.BaseLLM`, overriding `call()`), no network/keys.
- `ForgeEventListener` (subclass of `crewai.events.BaseEventListener`) captured **12 events** across the lifecycle: `crew.kickoff.started/completed`, `task.started/completed` ×2, `agent.execution.started/completed` ×2. This is the observability spine — in prod, `emit()` HTTP-POSTs to `/api/internal/events`.
- The container is just an isolation wrapper; this in-process run validates the identical plumbing.

### ⚠️ Key finding: do NOT use crewai's native `human_input`
- With `Task(human_input=True)`, crewai 1.14.6 **crashes** inside its experimental executor: `'AgentExecutor' object has no attribute 'ask_for_human_input'` (`crewai/core/providers/human_input.py:256`). It also no longer reads `stdin`, so an `input()` monkeypatch is never hit.
- **Resolution — model HITL as a task `guardrail` we own.** crewai calls the guardrail with the task output *before* passing it downstream; we inspect it, "ask the human" (long-poll the control plane in prod), and return `(approved, value)`. Returning `(False, feedback)` triggers a built-in revision loop. This is version-robust (unaffected by crewai's HITL internals) and is the **better** design — it became the chosen mechanism, matching the design doc's "approve/edit gate" fallback.
- Minor gotcha: guardrail callables must **not** carry a `-> tuple[bool, Any]` return annotation (validator wants `Tuple[bool, Any]`); leave it unannotated.

→ Adopt the guardrail-gate HITL model in P1. Drop reliance on native `human_input`.

## Architecture verdict

Both highest-risk assumptions are proven. Greenlight P0 scaffolding. Carry forward:
1. Pin worker Python to **3.12** (not 3.14).
2. Custom-LLM contract is stable and simple (`BaseLLM.call`) — useful for a built-in "mock/dry-run LLM" run mode (free testing, mirrors the news project's dry-run philosophy).
3. HITL = guardrail gates, not native `human_input`.
4. Event spine binds to `crewai.events.types.*` classes (150 available); subscribe to the lifecycle subset + tool/LLM events.
