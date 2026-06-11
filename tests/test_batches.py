"""Batch runs: CSV parsing, the sequential driver, aggregate totals, cancellation."""
import time

import pytest

from server import batches, store


class _StubRuns:
    """Stands in for RunManager. By default runs finish immediately; with
    hang=True they stay 'running' until cancelled (to exercise batch cancel)."""
    def __init__(self, *, hang: bool = False):
        self.hang = hang
        self.runs: dict[str, dict] = {}
        self.started: list[dict] = []

    def start(self, spec, *, dry_run=True, inputs=None, trigger="manual",
              batch_id=None, batch_index=None):
        rid = f"run-{len(self.runs) + 1}"
        self.started.append({"id": rid, "inputs": inputs, "trigger": trigger,
                             "batch_index": batch_index, "batch_id": batch_id})
        self.runs[rid] = {"id": rid, "status": "running" if self.hang else "succeeded",
                          "cost": 0.01, "tokens": 100, "inputs": inputs,
                          "batch_id": batch_id, "batch_index": batch_index}
        return rid

    def get(self, rid):
        return self.runs.get(rid)

    def cancel(self, rid):
        r = self.runs.get(rid)
        if r and r["status"] == "running":
            r["status"] = "cancelled"
        return True


def _wait(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def _spec():
    return {"id": "ws-batch", "name": "Newsroom",
            "agents": [{"id": "a1", "role": "R", "goal": "g", "backstory": "b"}],
            "tasks": [{"agent": "a1", "name": "t", "description": "d", "expected_output": "o"}],
            "inputs": [{"name": "topic", "default": "agents"}, {"name": "lang", "default": "en"}]}


# -- CSV parsing -------------------------------------------------------------
def test_rows_from_csv_keeps_known_columns_and_skips_blanks():
    csv = "topic,lang,ignored\nAI,en,x\nrobots,fr,y\n\n ,, \n"
    rows = batches.rows_from_csv(csv, ["topic", "lang"])
    assert rows == [{"topic": "AI", "lang": "en"}, {"topic": "robots", "lang": "fr"}]


def test_rows_from_csv_rejects_unmatched_header_and_empty_body():
    with pytest.raises(ValueError):
        batches.rows_from_csv("foo,bar\n1,2", ["topic"])
    with pytest.raises(ValueError):
        batches.rows_from_csv("topic\n", ["topic"])  # header only


# -- driver ------------------------------------------------------------------
def test_batch_runs_every_row_with_merged_inputs_and_aggregates():
    store.init()
    runs = _StubRuns()
    rows = [{"topic": "AI"}, {"topic": "robots", "lang": "fr"}, {"topic": "space"}]
    b = batches.start(runs, _spec(), rows, dry_run=True)

    assert _wait(lambda: (store.get_batch(b["id"]) or {}).get("status") == "done")
    final = store.get_batch(b["id"])
    assert final["total"] == 3 and final["finished"] == 3 and final["succeeded"] == 3
    assert final["cost"] == pytest.approx(0.03) and final["tokens"] == 300
    assert len(final["run_ids"]) == 3

    # each row started one run, defaults filled the gaps, batch trigger + index set
    assert [s["inputs"]["topic"] for s in runs.started] == ["AI", "robots", "space"]
    assert runs.started[0]["inputs"]["lang"] == "en"   # default
    assert runs.started[1]["inputs"]["lang"] == "fr"   # override
    assert all(s["trigger"] == f"batch:{b['id']}" for s in runs.started)
    assert [s["batch_index"] for s in runs.started] == [0, 1, 2]
    store.delete_batch(b["id"])


def test_batch_cancel_stops_remaining_rows():
    store.init()
    runs = _StubRuns(hang=True)  # runs never finish on their own
    rows = [{"topic": "a"}, {"topic": "b"}, {"topic": "c"}]
    b = batches.start(runs, _spec(), rows, dry_run=True)

    assert _wait(lambda: len(runs.started) >= 1)  # first row is in flight
    assert batches.cancel(b["id"]) is True
    assert _wait(lambda: (store.get_batch(b["id"]) or {}).get("status") == "cancelled")
    final = store.get_batch(b["id"])
    assert final["status"] == "cancelled"
    assert len(runs.started) < 3  # did not start every row
    assert runs.runs[runs.started[0]["id"]]["status"] == "cancelled"
    assert batches.cancel("batch-nope") is False  # unknown / already-finished
    store.delete_batch(b["id"])


def test_start_rejects_empty_rows():
    store.init()
    with pytest.raises(ValueError):
        batches.start(_StubRuns(), _spec(), [], dry_run=True)
