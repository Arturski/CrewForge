"""Quality & evaluation — run a workflow over a labelled test set and score it.

This is the measurement layer on top of batch runs: an eval executes the
workflow once per *case* (a set of run inputs + a list of *checks*), scores the
final output against those checks, and reports a pass-rate. Checks are
deterministic assertions (contains / not_contains / regex / equals) plus an
optional **LLM-as-judge** (`judge`) that asks the configured model whether the
output satisfies a plain-language criterion — the only check that needs a live
provider.

Like batches, a driver thread runs the cases sequentially through the shared
RunManager (each case is a tracked run, trigger="eval:<id>"), so the timeline /
canvas / cost all work per case. The eval record tracks live progress + score.
"""
from __future__ import annotations

import datetime as dt
import re
import threading
import time
import uuid
from typing import Any

from . import store

_TERMINAL = {"succeeded", "failed", "cancelled"}
_POLL_SECONDS = 0.3
CHECK_TYPES = {"contains", "not_contains", "regex", "equals", "judge"}
_cancels: dict[str, threading.Event] = {}
_lock = threading.Lock()


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _run_check(text: str, check: dict[str, Any], judge: Any | None) -> dict[str, Any]:
    """Evaluate one check against the output text. Returns {type, value, ok, detail}."""
    ctype = check.get("type")
    value = str(check.get("value") or "")
    cs = bool(check.get("case_sensitive"))
    res = {"type": ctype, "value": value, "ok": False, "detail": ""}

    if ctype == "regex":
        try:
            res["ok"] = re.search(value, text, 0 if cs else re.IGNORECASE) is not None
        except re.error as e:
            res["detail"] = f"bad regex: {e}"
        return res
    if ctype in ("contains", "not_contains", "equals"):
        t, v = (text, value) if cs else (text.lower(), value.lower())
        if ctype == "contains":
            res["ok"] = v in t
        elif ctype == "not_contains":
            res["ok"] = v not in t
        else:  # equals
            res["ok"] = t.strip() == v.strip()
        return res
    if ctype == "judge":
        if judge is None:
            res["detail"] = "needs a live model (dry-run can't judge)"
            return res
        res["ok"], res["detail"] = _judge(judge, text, value)
        return res
    res["detail"] = f"unknown check type: {ctype}"
    return res


_JUDGE_PROMPT = (
    "You are grading an AI agent's output against a single criterion.\n"
    "CRITERION: {criterion}\n\n"
    "OUTPUT:\n{output}\n\n"
    "Does the OUTPUT satisfy the CRITERION? Reply on one line as "
    "'PASS — <short reason>' or 'FAIL — <short reason>'."
)


def _judge(llm: Any, text: str, criterion: str) -> tuple[bool, str]:
    """LLM-as-judge: ask the model whether the output meets the criterion."""
    try:
        raw = str(llm.call(_JUDGE_PROMPT.format(criterion=criterion, output=text[:6000])))
    except Exception as e:  # noqa: BLE001
        return False, f"judge error: {type(e).__name__}: {e}"[:200]
    head = raw.strip()[:200]
    ok = bool(re.match(r"\s*pass\b", raw.strip(), re.IGNORECASE))
    return ok, head


def score_output(text: str, checks: list[dict[str, Any]], judge: Any | None = None) -> dict[str, Any]:
    """Score one output against its checks. A case passes only if every check passes
    (a case with no checks is treated as 'passed' — it just runs)."""
    results = [_run_check(text, c, judge) for c in (checks or [])]
    passed = all(r["ok"] for r in results) if results else True
    return {"passed": passed, "results": results}


def _build_judge(dry_run: bool, cases: list[dict[str, Any]]) -> Any | None:
    """Build the judge LLM only if some case uses a judge check and we're live."""
    if dry_run or not any(c.get("type") == "judge"
                          for case in cases for c in (case.get("checks") or [])):
        return None
    from . import llms
    return llms.build()


def _drive(runs_manager: Any, eval_id: str, spec: dict[str, Any],
           cases: list[dict[str, Any]], dry_run: bool) -> None:
    cancel = _cancels[eval_id]
    defaults = {i["name"]: i.get("default") or ""
                for i in (spec.get("inputs") or []) if i.get("name")}
    judge = _build_judge(dry_run, cases)
    try:
        for idx, case in enumerate(cases):
            if cancel.is_set():
                break
            inputs = {**defaults, **{k: str(v) for k, v in (case.get("inputs") or {}).items()}}
            run_id = runs_manager.start(spec, dry_run=dry_run, inputs=inputs,
                                        trigger=f"eval:{eval_id}")
            while True:
                run = runs_manager.get(run_id) or {}
                if run.get("status") in _TERMINAL:
                    break
                if cancel.is_set():
                    runs_manager.cancel(run_id)
                time.sleep(_POLL_SECONDS)
            run = runs_manager.get(run_id) or {}
            scored = score_output(str(run.get("result") or ""), case.get("checks") or [], judge)
            ev = store.get_eval(eval_id) or {}
            ev["cases"][idx].update({"run_id": run_id, "status": run.get("status"),
                                     "passed": scored["passed"], "checks_run": scored["results"]})
            ev["finished"] = ev.get("finished", 0) + 1
            if scored["passed"]:
                ev["passed"] = ev.get("passed", 0) + 1
            else:
                ev["failed"] = ev.get("failed", 0) + 1
            if run.get("cost"):
                ev["cost"] = round((ev.get("cost") or 0.0) + run["cost"], 6)
            ev["tokens"] = ev.get("tokens", 0) + (run.get("tokens") or 0)
            ev["score"] = round(ev["passed"] / ev["total"], 4) if ev["total"] else None
            store.save_eval(ev)
    finally:
        ev = store.get_eval(eval_id) or {}
        ev["status"] = "cancelled" if cancel.is_set() else "done"
        ev["finished_at"] = _now()
        store.save_eval(ev)
        with _lock:
            _cancels.pop(eval_id, None)


def start(runs_manager: Any, spec: dict[str, Any], cases: list[dict[str, Any]], *,
          dry_run: bool = True, name: str | None = None) -> dict[str, Any]:
    """Create an eval run and kick off its driver thread; returns the eval record."""
    if not cases:
        raise ValueError("an eval needs at least one test case")
    for case in cases:
        for c in (case.get("checks") or []):
            if c.get("type") not in CHECK_TYPES:
                raise ValueError(f"unknown check type: {c.get('type')}")
    eid = f"eval-{uuid.uuid4().hex[:8]}"
    ev = {
        "id": eid, "workspace_id": spec.get("id", ""),
        "name": name or f"{spec.get('name', 'workflow')} tests ×{len(cases)}",
        "dry_run": dry_run, "total": len(cases), "status": "running",
        "finished": 0, "passed": 0, "failed": 0, "score": None,
        "cost": None, "tokens": 0, "created_at": _now(), "finished_at": None,
        "cases": [{"index": i, "inputs": c.get("inputs") or {}, "checks": c.get("checks") or [],
                   "run_id": None, "status": None, "passed": None, "checks_run": []}
                  for i, c in enumerate(cases)],
    }
    store.save_eval(ev)
    with _lock:
        _cancels[eid] = threading.Event()
    threading.Thread(target=_drive, args=(runs_manager, eid, spec, cases, dry_run),
                     daemon=True, name=f"crewforge-eval-{eid}").start()
    return ev


def cancel(eid: str) -> bool:
    with _lock:
        cev = _cancels.get(eid)
    if cev is None:
        return False
    cev.set()
    return True


def get(eid: str) -> dict[str, Any] | None:
    return store.get_eval(eid)


def list_evals(workspace_id: str | None = None) -> list[dict[str, Any]]:
    return store.list_evals(workspace_id)
