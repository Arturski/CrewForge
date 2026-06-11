"""Batch runs — execute one workflow over many input rows.

This is crewai's `kickoff_for_each`, but each row is a first-class tracked run
(its own timeline, canvas lights, cost, replay) rather than one opaque combined
output. A driver thread runs the rows *sequentially* through the shared
RunManager — same "no pileups / no rate-limit storms" philosophy as the
scheduler — and the batch record tracks live progress + aggregate cost.

A batch = {id, workspace_id, name, dry_run, total, status, run_ids,
finished, succeeded, failed, cost, created_at}. Status is running → done
(or cancelled). Runs carry trigger="batch:<id>" plus batch_id/batch_index so
the Runs page can group them.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import threading
import time
import uuid
from typing import Any

from . import store

_TERMINAL = {"succeeded", "failed", "cancelled"}
_POLL_SECONDS = 0.3
# In-process cancel flags for active batches (threads don't survive restart,
# same as RunManager's per-run _cancel events).
_cancels: dict[str, threading.Event] = {}
_lock = threading.Lock()


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def rows_from_csv(text: str, input_names: list[str]) -> list[dict[str, str]]:
    """Parse pasted CSV into input rows. The header names the input variables;
    only columns matching a known input name are kept. Fully-blank rows are
    skipped. Raises ValueError when no header column matches an input."""
    reader = csv.DictReader(io.StringIO(text.strip()))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    known = [h for h in headers if h in set(input_names)]
    if not known:
        raise ValueError(
            f"CSV header has no column matching a workflow input ({', '.join(input_names) or 'none defined'})"
        )
    rows: list[dict[str, str]] = []
    for raw in reader:
        row = {h: (raw.get(h) or "").strip() for h in known}
        if any(row.values()):
            rows.append(row)
    if not rows:
        raise ValueError("CSV has a header but no data rows")
    return rows


def _agg(batch: dict[str, Any], run: dict[str, Any]) -> None:
    """Fold one finished run's outcome into the batch totals."""
    batch["finished"] = batch.get("finished", 0) + 1
    status = run.get("status")
    if status == "succeeded":
        batch["succeeded"] = batch.get("succeeded", 0) + 1
    elif status == "cancelled":
        batch["cancelled_runs"] = batch.get("cancelled_runs", 0) + 1
    else:
        batch["failed"] = batch.get("failed", 0) + 1
    if run.get("cost"):
        batch["cost"] = round((batch.get("cost") or 0.0) + run["cost"], 6)
    batch["tokens"] = batch.get("tokens", 0) + (run.get("tokens") or 0)


def _drive(runs_manager: Any, batch_id: str, spec: dict[str, Any],
           rows: list[dict[str, str]], dry_run: bool) -> None:
    cancel = _cancels[batch_id]
    defaults = {i["name"]: i.get("default") or ""
                for i in (spec.get("inputs") or []) if i.get("name")}
    try:
        for idx, row in enumerate(rows):
            if cancel.is_set():
                break
            inputs = {**defaults, **row}
            run_id = runs_manager.start(spec, dry_run=dry_run, inputs=inputs,
                                        trigger=f"batch:{batch_id}",
                                        batch_id=batch_id, batch_index=idx)
            batch = store.get_batch(batch_id) or {}
            batch.setdefault("run_ids", []).append(run_id)
            store.save_batch(batch)
            # Wait for this row to finish before starting the next (sequential).
            while True:
                run = runs_manager.get(run_id) or {}
                if run.get("status") in _TERMINAL:
                    break
                if cancel.is_set():
                    runs_manager.cancel(run_id)
                time.sleep(_POLL_SECONDS)
            batch = store.get_batch(batch_id) or {}
            _agg(batch, runs_manager.get(run_id) or {})
            store.save_batch(batch)
    finally:
        batch = store.get_batch(batch_id) or {}
        batch["status"] = "cancelled" if cancel.is_set() else "done"
        batch["finished_at"] = _now()
        store.save_batch(batch)
        with _lock:
            _cancels.pop(batch_id, None)


def start(runs_manager: Any, spec: dict[str, Any], rows: list[dict[str, str]], *,
          dry_run: bool = True, name: str | None = None) -> dict[str, Any]:
    """Create a batch and kick off its driver thread; returns the batch record."""
    if not rows:
        raise ValueError("a batch needs at least one input row")
    bid = f"batch-{uuid.uuid4().hex[:8]}"
    batch = {
        "id": bid, "workspace_id": spec.get("id", ""),
        "name": name or f"{spec.get('name', 'workflow')} ×{len(rows)}",
        "dry_run": dry_run, "total": len(rows), "status": "running",
        "run_ids": [], "finished": 0, "succeeded": 0, "failed": 0,
        "cancelled_runs": 0, "cost": None, "tokens": 0,
        "created_at": _now(), "finished_at": None,
    }
    store.save_batch(batch)
    with _lock:
        _cancels[bid] = threading.Event()
    threading.Thread(target=_drive, args=(runs_manager, bid, spec, rows, dry_run),
                     daemon=True, name=f"crewforge-batch-{bid}").start()
    return batch


def cancel(bid: str) -> bool:
    """Stop a running batch: no further rows start, the in-flight run is cancelled."""
    with _lock:
        ev = _cancels.get(bid)
    if ev is None:
        return False
    ev.set()
    return True


def get(bid: str) -> dict[str, Any] | None:
    return store.get_batch(bid)


def list_batches(workspace_id: str | None = None) -> list[dict[str, Any]]:
    return store.list_batches(workspace_id)
