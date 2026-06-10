"""Run-loop control tests — HITL gate blocking + cancellation. Dry-run, no network."""
import time

from server import store
from server.runner import RunManager

SPEC = {
    "id": "ws-hitl-test",
    "name": "HITL Test Crew",
    "process": "sequential",
    "agents": [{"id": "a1", "role": "Writer", "goal": "write", "backstory": "bg"}],
    "tasks": [{"agent": "a1", "name": "t1", "description": "draft a line",
               "expected_output": "a line", "human_input": True}],
}


def _wait(predicate, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return False


def test_hitl_gate_blocks_then_approve_completes():
    store.init()
    rm = RunManager()
    rid = rm.start(SPEC, dry_run=True)

    assert _wait(lambda: rm.get(rid).get("hitl")), "gate never reached"
    rec = rm.get(rid)
    assert rec["status"] == "running"
    assert "dry-run output" in rec["hitl"]["output"]

    assert rm.hitl_decision(rid, {"decision": "approve"})
    assert _wait(lambda: rm.get(rid)["status"] != "running"), "run never finished"
    rec = rm.get(rid)
    assert rec["status"] == "succeeded"
    kinds = [e["kind"] for e in rec["events"]]
    assert "hitl.gate.reached" in kinds and "hitl.decision.received" in kinds


def test_hitl_edit_replaces_output():
    store.init()
    rm = RunManager()
    rid = rm.start(SPEC, dry_run=True)
    assert _wait(lambda: rm.get(rid).get("hitl"))
    assert rm.hitl_decision(rid, {"decision": "approve", "edit": "FINAL EDITED TEXT"})
    assert _wait(lambda: rm.get(rid)["status"] != "running")
    rec = rm.get(rid)
    assert rec["status"] == "succeeded"
    assert "FINAL EDITED TEXT" in (rec["result"] or "")


def test_cancel_at_gate_marks_cancelled():
    store.init()
    rm = RunManager()
    rid = rm.start(SPEC, dry_run=True)
    assert _wait(lambda: rm.get(rid).get("hitl"))
    assert rm.cancel(rid)
    assert _wait(lambda: rm.get(rid)["status"] != "running")
    rec = rm.get(rid)
    assert rec["status"] == "cancelled"
    assert rec.get("hitl") is None
    assert "run.cancelled" in [e["kind"] for e in rec["events"]]
    # decisions after the fact are rejected
    assert not rm.hitl_decision(rid, {"decision": "approve"})
    assert not rm.cancel(rid)
