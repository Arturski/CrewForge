"""Cron schedules — run workflows on a timer (the "operate" layer).

A schedule = {id, workspace_id, cron, inputs, dry_run, enabled, next_run_at,
last_run_at, last_run_id}. An in-process daemon thread ticks every ~15s and
kicks off due runs through the shared RunManager; a workspace that is still
running is skipped for that tick (no pileups). Cron expressions are evaluated
with croniter in server-local time; the run always uses the workspace's
CURRENT spec at fire time.
"""
from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

from croniter import croniter

from . import store

TICK_SECONDS = 15
_started = False
_lock = threading.Lock()


def _now() -> dt.datetime:
    return dt.datetime.now()


def next_run_at(cron: str, base: dt.datetime | None = None) -> str:
    """ISO timestamp of the next fire time; raises ValueError on a bad expression."""
    try:
        return croniter(cron, base or _now()).get_next(dt.datetime).isoformat(timespec="seconds")
    except Exception as e:  # croniter raises several exception types
        raise ValueError(f"invalid cron expression: {cron}") from e


def create(workspace_id: str, cron: str, *, inputs: dict[str, str] | None = None,
           dry_run: bool = False, enabled: bool = True) -> dict[str, Any]:
    s = {"id": f"sched-{uuid.uuid4().hex[:8]}", "workspace_id": workspace_id,
         "cron": cron, "inputs": inputs or {}, "dry_run": dry_run, "enabled": enabled,
         "next_run_at": next_run_at(cron), "last_run_at": None, "last_run_id": None}
    return store.save_schedule(s)


def update(sid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    s = store.get_schedule(sid)
    if not s:
        return None
    for key in ("cron", "inputs", "dry_run", "enabled"):
        if key in patch:
            s[key] = patch[key]
    s["next_run_at"] = next_run_at(s["cron"]) if s.get("enabled") else None
    return store.save_schedule(s)


def _workspace_busy(runs_manager: Any, workspace_id: str) -> bool:
    return any(r.get("workspace_id") == workspace_id and r.get("status") == "running"
               for r in runs_manager.list_runs())


def _run_inputs(spec: dict[str, Any], overrides: dict[str, str]) -> dict[str, str]:
    """Workspace input defaults, overridden by the schedule's pinned values."""
    inputs = {i["name"]: i.get("default") or "" for i in (spec.get("inputs") or []) if i.get("name")}
    inputs.update(overrides or {})
    return inputs


def tick(runs_manager: Any, now: dt.datetime | None = None) -> list[str]:
    """Fire every due schedule once; returns the started run ids."""
    now = now or _now()
    started: list[str] = []
    for s in store.list_schedules():
        if not s.get("enabled") or not s.get("next_run_at"):
            continue
        if dt.datetime.fromisoformat(s["next_run_at"]) > now:
            continue
        # due — always advance next_run_at first so a crash can't hot-loop
        s["next_run_at"] = next_run_at(s["cron"], now)
        spec = store.get_workspace(s["workspace_id"])
        if spec is None:  # workspace deleted under the schedule
            s["enabled"] = False
        elif _workspace_busy(runs_manager, s["workspace_id"]):
            pass  # skip this tick; the next due time is already set
        else:
            run_id = runs_manager.start(spec, dry_run=bool(s.get("dry_run")),
                                        inputs=_run_inputs(spec, s.get("inputs") or {}),
                                        trigger=f"schedule:{s['id']}")
            s["last_run_at"] = now.isoformat(timespec="seconds")
            s["last_run_id"] = run_id
            started.append(run_id)
        store.save_schedule(s)
    return started


def start(runs_manager: Any) -> None:
    """Start the background scheduler loop (idempotent)."""
    global _started
    with _lock:
        if _started:
            return
        _started = True

    def loop() -> None:
        import time
        while True:
            time.sleep(TICK_SECONDS)
            try:
                tick(runs_manager)
            except Exception:  # noqa: BLE001 — the scheduler must survive any tick
                pass

    threading.Thread(target=loop, daemon=True, name="crewforge-scheduler").start()
