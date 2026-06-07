"""In-process run manager + crewai event capture.

P0 runs execute in a background thread (containerized workers come later — the
plumbing is identical). crewai dispatches sync event handlers on a thread pool,
so we cannot correlate via thread-local. Instead, around each kickoff we register
per-run handlers (via the bus's `scoped_handlers` context) that close over the run
record — robust to which pool thread runs them, and auto-removed after the run.
"""
from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any, Callable

from crewai.events import crewai_event_bus
from crewai.events.types.agent_events import (
    AgentExecutionCompletedEvent,
    AgentExecutionStartedEvent,
)
from crewai.events.types.crew_events import (
    CrewKickoffCompletedEvent,
    CrewKickoffStartedEvent,
)
from crewai.events.types.task_events import TaskCompletedEvent, TaskStartedEvent

from .compiler.adapter import FakeLLM, build_crew


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _agent_role(ev: Any) -> dict[str, Any]:
    return {"agent": getattr(getattr(ev, "agent", None), "role", None)}


# (crewai event class, forge kind, field extractor)
EVENT_MAP: list[tuple[type, str, Callable[[Any], dict[str, Any]]]] = [
    (CrewKickoffStartedEvent, "crew.kickoff.started",
     lambda ev: {"crew": getattr(ev, "crew_name", None)}),
    (TaskStartedEvent, "task.started", lambda ev: {}),
    (AgentExecutionStartedEvent, "agent.execution.started", _agent_role),
    (AgentExecutionCompletedEvent, "agent.execution.completed", _agent_role),
    (TaskCompletedEvent, "task.completed", lambda ev: {}),
    (CrewKickoffCompletedEvent, "crew.kickoff.completed", lambda ev: {}),
]


class RunManager:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}

    def start(self, spec: dict[str, Any], *, dry_run: bool = True) -> str:
        run_id = uuid.uuid4().hex[:12]
        self.runs[run_id] = {
            "id": run_id,
            "status": "running",
            "dry_run": dry_run,
            "spec_name": spec.get("name", "workspace"),
            "started_at": _now(),
            "finished_at": None,
            "events": [],
            "result": None,
            "error": None,
            "_lock": threading.Lock(),
        }
        threading.Thread(target=self._execute, args=(run_id, spec, dry_run),
                         daemon=True).start()
        return run_id

    def _execute(self, run_id: str, spec: dict[str, Any], dry_run: bool) -> None:
        rec = self.runs[run_id]

        def emit(kind: str, **fields: Any) -> None:
            with rec["_lock"]:
                seq = len(rec["events"])
                rec["events"].append(
                    {"seq": seq, "ts": _now(), "kind": kind,
                     **{k: v for k, v in fields.items() if v is not None}}
                )

        def hitl_gate(output):  # worker-owned HITL gate (long-poll point in prod)
            emit("hitl.gate.reached", chars=len(getattr(output, "raw", str(output))))
            emit("hitl.decision.received", decision="auto-approve (dry-run)")
            return (True, output)

        try:
            crew = build_crew(spec, llm=FakeLLM(), hitl_gate=hitl_gate)
            with crewai_event_bus.scoped_handlers():
                for event_cls, kind, extract in EVENT_MAP:
                    def make(kind=kind, extract=extract):
                        def handler(source, event):  # runs on a pool thread
                            try:
                                extra = extract(event)
                            except Exception:  # noqa: BLE001
                                extra = {}
                            emit(kind, **extra)
                        return handler
                    crewai_event_bus.register_handler(event_cls, make())

                emit("run.started", crew=spec.get("name"))
                result = crew.kickoff()
                rec["result"] = str(getattr(result, "raw", result))[:4000]
            rec["status"] = "succeeded"
            emit("run.finished", status="succeeded")
        except Exception as e:  # noqa: BLE001
            rec["error"] = f"{type(e).__name__}: {e}"
            rec["status"] = "failed"
            emit("run.failed", error=rec["error"][:300])
        finally:
            rec["finished_at"] = _now()

    # -- reads --------------------------------------------------------------
    def get(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)

    def events_since(self, run_id: str, since: int) -> list[dict[str, Any]]:
        rec = self.runs.get(run_id)
        if not rec:
            return []
        with rec["_lock"]:
            return list(rec["events"][since:])

    def _public(self, rec: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in rec.items() if k not in ("events", "_lock")} | {
            "event_count": len(rec["events"])
        }

    def list_runs(self) -> list[dict[str, Any]]:
        return [self._public(r) for r in
                sorted(self.runs.values(), key=lambda r: r["started_at"], reverse=True)]
