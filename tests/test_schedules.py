"""Cron schedules: next-run math, tick firing, busy-skip, deleted-workspace handling."""
import datetime as dt

from server import schedules, store


class _StubRuns:
    """Stands in for RunManager: records starts, simulates a busy workspace."""
    def __init__(self, busy_ws: str | None = None):
        self.busy_ws = busy_ws
        self.started: list[tuple[str, str]] = []  # (workspace_id, trigger)

    def list_runs(self):
        return ([{"workspace_id": self.busy_ws, "status": "running"}] if self.busy_ws else [])

    def start(self, spec, *, dry_run=True, inputs=None, trigger="manual"):
        self.started.append((spec["id"], trigger))
        return f"run-{len(self.started)}"


def _mk_ws(ws_id: str) -> dict:
    ws = {"id": ws_id, "name": ws_id,
          "agents": [{"id": "a1", "role": "R", "goal": "g", "backstory": "b"}],
          "tasks": [{"agent": "a1", "name": "t", "description": "d", "expected_output": "o"}],
          "inputs": [{"name": "topic", "default": "agents"}]}
    return store.save_workspace(ws)


def test_next_run_at_and_validation():
    base = dt.datetime(2026, 6, 11, 8, 30)
    assert schedules.next_run_at("0 9 * * *", base) == "2026-06-11T09:00:00"
    try:
        schedules.next_run_at("not a cron")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_tick_fires_due_schedule_with_input_defaults():
    store.init()
    _mk_ws("ws-sched-1")
    s = schedules.create("ws-sched-1", "0 * * * *", inputs={"extra": "x"}, dry_run=True)
    # force due
    s["next_run_at"] = "2020-01-01T00:00:00"
    store.save_schedule(s)

    runs = _StubRuns()
    started = schedules.tick(runs, now=dt.datetime(2026, 6, 11, 9, 0))
    assert started == ["run-1"]
    assert runs.started == [("ws-sched-1", f"schedule:{s['id']}")]
    s2 = store.get_schedule(s["id"])
    assert s2["last_run_id"] == "run-1"
    assert dt.datetime.fromisoformat(s2["next_run_at"]) > dt.datetime(2026, 6, 11, 9, 0)
    # not due again on the next tick
    assert schedules.tick(runs, now=dt.datetime(2026, 6, 11, 9, 0, 30)) == []
    store.delete_schedule(s["id"])


def test_tick_skips_busy_workspace_and_disables_on_deleted():
    store.init()
    _mk_ws("ws-sched-busy")
    s_busy = schedules.create("ws-sched-busy", "0 * * * *")
    s_gone = schedules.create("ws-sched-gone", "0 * * * *")  # workspace never created
    for s in (s_busy, s_gone):
        s["next_run_at"] = "2020-01-01T00:00:00"
        store.save_schedule(s)

    runs = _StubRuns(busy_ws="ws-sched-busy")
    assert schedules.tick(runs, now=dt.datetime(2026, 6, 11, 9, 0)) == []
    assert runs.started == []
    assert store.get_schedule(s_busy["id"])["enabled"] is True  # busy: just skipped
    assert store.get_schedule(s_gone["id"])["enabled"] is False  # deleted ws: disabled
    store.delete_schedule(s_busy["id"])
    store.delete_schedule(s_gone["id"])


def test_update_recomputes_next_run_and_pause_clears_it():
    store.init()
    _mk_ws("ws-sched-2")
    s = schedules.create("ws-sched-2", "0 9 * * *")
    paused = schedules.update(s["id"], {"enabled": False})
    assert paused["next_run_at"] is None
    resumed = schedules.update(s["id"], {"enabled": True, "cron": "30 8 * * *"})
    assert resumed["next_run_at"].endswith("08:30:00")
    assert schedules.update("sched-missing", {"enabled": False}) is None
    store.delete_schedule(s["id"])
