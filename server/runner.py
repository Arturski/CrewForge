"""In-process run manager: builds a crew from a spec, runs it (dry-run mock LLM or
a configured live provider), and captures the crewai event lifecycle for live
observability. Runs and events are persisted to the store so history survives
restarts; the in-memory copy powers low-latency SSE for active runs.
"""
from __future__ import annotations

import datetime as dt
import threading
import time
import uuid
from typing import Any

from crewai.events import crewai_event_bus
from crewai.events.types.agent_events import (
    AgentExecutionCompletedEvent,
    AgentExecutionErrorEvent,
    AgentExecutionStartedEvent,
)
from crewai.events.types.crew_events import (
    CrewKickoffCompletedEvent,
    CrewKickoffStartedEvent,
)
from crewai.events.types.llm_events import LLMCallCompletedEvent
from crewai.events.types.task_events import TaskCompletedEvent, TaskStartedEvent
from crewai.events.types.tool_usage_events import (
    ToolUsageFinishedEvent,
    ToolUsageStartedEvent,
)

from . import llms, mcp, store
from .compiler.adapter import FakeLLM, build_crew


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _role(ev: Any) -> str | None:
    return getattr(getattr(ev, "agent", None), "role", None)


def _ms(start: float | None) -> int | None:
    return round((time.monotonic() - start) * 1000) if start else None


def _extract_tokens(ev: Any) -> int:
    """Best-effort token count from an LLM completion event (provider-dependent)."""
    for attr in ("usage", "token_usage", "response"):
        obj = getattr(ev, attr, None)
        if obj is None:
            continue
        for key in ("total_tokens", "total"):
            val = getattr(obj, key, None) or (obj.get(key) if isinstance(obj, dict) else None)
            if isinstance(val, int):
                return val
    return 0


class RunManager:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}

    def _build_llm(self, dry_run: bool, llm_id: str | None = None):
        if dry_run:
            return FakeLLM(), True
        built = llms.build(llm_id)  # configured connection (or default)
        return (built, False) if built is not None else (FakeLLM(), True)

    def start(self, spec: dict[str, Any], *, dry_run: bool = True,
              inputs: dict[str, Any] | None = None) -> str:
        run_id = uuid.uuid4().hex[:12]
        rec = {
            "id": run_id,
            "workspace_id": spec.get("id", ""),
            "status": "running",
            "dry_run": dry_run,
            "spec_name": spec.get("name", "workspace"),
            "started_at": _now(),
            "finished_at": None,
            "events": [],
            "result": None,
            "error": None,
            "tokens": 0,
            "inputs": inputs or {},
            "_lock": threading.Lock(),
        }
        self.runs[run_id] = rec
        store.create_run(self._public(rec))
        threading.Thread(target=self._execute, args=(run_id, spec, dry_run, inputs or {}),
                         daemon=True).start()
        return run_id

    def _execute(self, run_id: str, spec: dict[str, Any], dry_run: bool,
                 inputs: dict[str, Any]) -> None:
        rec = self.runs[run_id]

        def emit(kind: str, **fields: Any) -> None:
            with rec["_lock"]:
                seq = len(rec["events"])
                evt = {"seq": seq, "ts": _now(), "kind": kind,
                       **{k: v for k, v in fields.items() if v is not None}}
                rec["events"].append(evt)
            store.append_event(run_id, evt)

        def hitl_gate(output):
            emit("hitl.gate.reached", chars=len(getattr(output, "raw", str(output))))
            emit("hitl.decision.received", decision="auto-approve (dry-run)")
            return (True, output)

        adapters: list = []
        try:
            llm, effective_dry = self._build_llm(dry_run, spec.get("llm_id"))
            rec["dry_run"] = effective_dry

            # Live runs: connect MCP servers and attach their tools to agents.
            # Skills attach at two scopes: per-agent (agent.tools) and
            # workflow-wide (spec.skills, shared by every agent).
            agent_tools = None
            if not effective_dry:
                workflow_skills = list(spec.get("skills") or [])
                skill_names: set[str] = set(workflow_skills)
                for a in spec.get("agents", []):
                    skill_names |= set(a.get("tools") or [])
                if skill_names:
                    try:
                        tools, adapters = mcp.open_tools_for(skill_names)
                        if tools:
                            by_name = {t.name: t for t in tools}
                            agent_tools = {}
                            for a in spec.get("agents", []):
                                names = list(a.get("tools") or []) + workflow_skills
                                ats = [by_name[n] for n in dict.fromkeys(names) if n in by_name]
                                if ats:
                                    agent_tools[a["id"]] = ats
                            emit("mcp.tools.attached", count=len(tools))
                    except Exception as e:  # noqa: BLE001
                        emit("mcp.error", error=str(e)[:200])

            # Per-agent LLM overrides: each agent can pick a configured connection.
            agent_llms: dict[str, Any] = {}
            if not effective_dry:
                for a in spec.get("agents", []):
                    if a.get("llm_id"):
                        built = llms.build(a["llm_id"])
                        if built is not None:
                            agent_llms[a["id"]] = built

            # Knowledge-base tools (keyless local embeddings → attach in any mode).
            wf_kbs = list(spec.get("knowledge") or [])
            if any(a.get("knowledge") for a in spec.get("agents", [])) or wf_kbs:
                from .compiler.knowledge_tool import make_tool
                kb_cache: dict[str, Any] = {}

                def _kb_tool(kid: str):
                    if kid not in kb_cache:
                        kb = store.get_kb(kid)
                        kb_cache[kid] = make_tool(kb) if kb else None
                    return kb_cache[kid]

                for a in spec.get("agents", []):
                    ids = list(dict.fromkeys(list(a.get("knowledge") or []) + wf_kbs))
                    ktools = [t for t in (_kb_tool(i) for i in ids) if t]
                    if ktools:
                        agent_tools = agent_tools or {}
                        agent_tools[a["id"]] = (agent_tools.get(a["id"]) or []) + ktools
                if wf_kbs or any(a.get("knowledge") for a in spec.get("agents", [])):
                    emit("knowledge.attached", count=sum(len(v) for v in (agent_tools or {}).values()))

            crew = build_crew(spec, llm=llm, hitl_gate=hitl_gate, agent_tools=agent_tools,
                              agent_llms=agent_llms)

            tasks = spec.get("tasks", [])
            st = {"task_idx": -1, "starts": {}, "task_tokens": {}}

            def reg(event_cls, fn):
                crewai_event_bus.register_handler(event_cls, fn)

            with crewai_event_bus.scoped_handlers():
                reg(CrewKickoffStartedEvent,
                    lambda s, e: emit("crew.kickoff.started", crew=getattr(e, "crew_name", None)))

                def on_task_start(s, e):
                    st["task_idx"] += 1
                    i = st["task_idx"]
                    st["starts"][f"task:{i}"] = time.monotonic()
                    name = (tasks[i].get("name") if i < len(tasks) else None) or f"task {i + 1}"
                    emit("task.started", task_index=i, task=name)
                reg(TaskStartedEvent, on_task_start)

                def on_agent_start(s, e):
                    role = _role(e)
                    if role:
                        st["starts"][f"agent:{role}"] = time.monotonic()
                    emit("agent.execution.started", agent=role)
                reg(AgentExecutionStartedEvent, on_agent_start)

                def on_agent_done(s, e):
                    role = _role(e)
                    ms = _ms(st["starts"].pop(f"agent:{role}", None))
                    emit("agent.execution.completed", agent=role, ms=ms)
                reg(AgentExecutionCompletedEvent, on_agent_done)

                def on_llm_done(s, e):
                    tk = _extract_tokens(e)
                    rec["tokens"] += tk
                    i = st["task_idx"]
                    if i >= 0:
                        st["task_tokens"][i] = st["task_tokens"].get(i, 0) + tk
                reg(LLMCallCompletedEvent, on_llm_done)

                def on_task_done(s, e):
                    i = st["task_idx"]
                    emit("task.completed", task_index=i, ms=_ms(st["starts"].pop(f"task:{i}", None)),
                         tokens=st["task_tokens"].get(i) or None)
                reg(TaskCompletedEvent, on_task_done)

                def on_tool_start(s, e):
                    emit("tool.started", tool=getattr(e, "tool_name", None))
                reg(ToolUsageStartedEvent, on_tool_start)

                def on_tool_done(s, e):
                    emit("tool.finished", tool=getattr(e, "tool_name", None))
                reg(ToolUsageFinishedEvent, on_tool_done)

                def on_agent_error(s, e):
                    emit("agent.error", agent=_role(e), error=str(getattr(e, "error", ""))[:300])
                reg(AgentExecutionErrorEvent, on_agent_error)

                reg(CrewKickoffCompletedEvent, lambda s, e: emit("crew.kickoff.completed"))

                emit("run.started", crew=spec.get("name"),
                     mode="dry-run" if effective_dry else "live")
                result = crew.kickoff(inputs=inputs) if inputs else crew.kickoff()
                rec["result"] = str(getattr(result, "raw", result))[:4000]
            rec["status"] = "succeeded"
            emit("run.finished", status="succeeded", tokens=rec["tokens"] or None)
        except Exception as e:  # noqa: BLE001
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["status"] = "failed"
            emit("run.failed", error=rec["error"][:300])
        finally:
            for ad in adapters:
                try:
                    ad.stop()
                except Exception:  # noqa: BLE001
                    pass
            rec["finished_at"] = _now()
            store.update_run(self._public(rec))

    # -- reads --------------------------------------------------------------
    def get(self, run_id: str) -> dict[str, Any] | None:
        rec = self.runs.get(run_id)
        if rec:
            return rec
        return store.get_run(run_id)  # historical

    def events_since(self, run_id: str, since: int) -> list[dict[str, Any]]:
        rec = self.runs.get(run_id)
        if rec:
            with rec["_lock"]:
                return list(rec["events"][since:])
        return store.get_events(run_id, since)  # historical

    def _public(self, rec: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in rec.items() if k not in ("events", "_lock")} | {
            "event_count": len(rec["events"]) if "events" in rec else rec.get("event_count", 0)
        }

    def list_runs(self) -> list[dict[str, Any]]:
        return store.list_runs()
