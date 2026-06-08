"""In-process run manager: builds a crew from a spec, runs it (dry-run mock LLM or
a configured live provider), and captures the crewai event lifecycle for live
observability. Runs and events are persisted to the store so history survives
restarts; the in-memory copy powers low-latency SSE for active runs.
"""
from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any, Callable

from crewai import LLM
from crewai.events import crewai_event_bus
from crewai.events.types.agent_events import (
    AgentExecutionCompletedEvent,
    AgentExecutionStartedEvent,
)
from crewai.events.types.crew_events import (
    CrewKickoffCompletedEvent,
    CrewKickoffStartedEvent,
)
from crewai.events.types.llm_events import LLMCallCompletedEvent
from crewai.events.types.task_events import TaskCompletedEvent, TaskStartedEvent

from . import mcp, store
from .compiler.adapter import FakeLLM, build_crew


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _agent_role(ev: Any) -> dict[str, Any]:
    return {"agent": getattr(getattr(ev, "agent", None), "role", None)}


EVENT_MAP: list[tuple[type, str, Callable[[Any], dict[str, Any]]]] = [
    (CrewKickoffStartedEvent, "crew.kickoff.started",
     lambda ev: {"crew": getattr(ev, "crew_name", None)}),
    (TaskStartedEvent, "task.started", lambda ev: {}),
    (AgentExecutionStartedEvent, "agent.execution.started", _agent_role),
    (AgentExecutionCompletedEvent, "agent.execution.completed", _agent_role),
    (TaskCompletedEvent, "task.completed", lambda ev: {}),
    (CrewKickoffCompletedEvent, "crew.kickoff.completed", lambda ev: {}),
]


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

    def _build_llm(self, dry_run: bool):
        if dry_run:
            return FakeLLM(), True
        cfg = store.get_setting("llm")
        if not cfg or not cfg.get("model"):
            return FakeLLM(), True  # no provider configured -> safe dry-run fallback
        kwargs: dict[str, Any] = {"model": cfg["model"]}
        if cfg.get("api_key"):
            kwargs["api_key"] = cfg["api_key"]
        if cfg.get("base_url"):
            kwargs["base_url"] = cfg["base_url"]
        if cfg.get("temperature") is not None:
            kwargs["temperature"] = cfg["temperature"]
        return LLM(**kwargs), False

    def start(self, spec: dict[str, Any], *, dry_run: bool = True) -> str:
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
            "_lock": threading.Lock(),
        }
        self.runs[run_id] = rec
        store.create_run(self._public(rec))
        threading.Thread(target=self._execute, args=(run_id, spec, dry_run),
                         daemon=True).start()
        return run_id

    def _execute(self, run_id: str, spec: dict[str, Any], dry_run: bool) -> None:
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
            llm, effective_dry = self._build_llm(dry_run)
            rec["dry_run"] = effective_dry

            # Live runs: connect MCP servers and attach their tools to agents.
            agent_tools = None
            if not effective_dry:
                skill_names: set[str] = set()
                for a in spec.get("agents", []):
                    skill_names |= set(a.get("tools") or [])
                if skill_names:
                    try:
                        tools, adapters = mcp.open_tools_for(skill_names)
                        if tools:
                            by_name = {t.name: t for t in tools}
                            agent_tools = {}
                            for a in spec.get("agents", []):
                                ats = [by_name[n] for n in (a.get("tools") or []) if n in by_name]
                                if ats:
                                    agent_tools[a["id"]] = ats
                            emit("mcp.tools.attached", count=len(tools))
                    except Exception as e:  # noqa: BLE001
                        emit("mcp.error", error=str(e)[:200])

            crew = build_crew(spec, llm=llm, hitl_gate=hitl_gate, agent_tools=agent_tools)
            with crewai_event_bus.scoped_handlers():
                for event_cls, kind, extract in EVENT_MAP:
                    def make(kind=kind, extract=extract):
                        def handler(source, event):
                            try:
                                extra = extract(event)
                            except Exception:  # noqa: BLE001
                                extra = {}
                            emit(kind, **extra)
                        return handler
                    crewai_event_bus.register_handler(event_cls, make())

                def on_llm_done(source, event):
                    rec["tokens"] += _extract_tokens(event)
                crewai_event_bus.register_handler(LLMCallCompletedEvent, on_llm_done)

                emit("run.started", crew=spec.get("name"),
                     mode="dry-run" if effective_dry else "live")
                result = crew.kickoff()
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
