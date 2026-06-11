"""Conditional tasks — no-code run conditions on previous task output. Dry-run, no network."""
import time

from crewai.tasks.conditional_task import ConditionalTask

from server import store
from server.compiler.adapter import FakeLLM, build_crew, make_condition
from server.compiler.exporter import export_files
from server.runner import RunManager


class _Out:
    def __init__(self, raw: str):
        self.raw = raw


def test_make_condition_checks():
    assert make_condition({"check": "contains", "value": "Apple"})(_Out("an apple a day"))
    assert not make_condition({"check": "contains", "value": "Apple",
                               "case_sensitive": True})(_Out("an apple a day"))
    assert make_condition({"check": "not_contains", "value": "zzz"})(_Out("clean"))
    assert make_condition({"check": "regex", "value": r"score:\s*[89]"})(_Out("SCORE: 9 / 10"))
    assert not make_condition({"check": "regex", "value": r"^\d+$"})(_Out("not a number"))


def test_adapter_builds_conditional_task_and_validates():
    agents = [{"id": "a1", "role": "Analyst", "goal": "g", "backstory": "b"}]
    base = {"agent": "a1", "description": "d", "expected_output": "o"}
    crew = build_crew({"agents": agents, "tasks": [
        dict(base, name="t1"),
        dict(base, name="t2", condition={"check": "contains", "value": "x"}),
    ]}, llm=FakeLLM())
    assert not isinstance(crew.tasks[0], ConditionalTask)
    assert isinstance(crew.tasks[1], ConditionalTask)

    for bad, msg in [
        ([dict(base, name="t1", condition={"check": "contains", "value": "x"})], "first task"),
        ([dict(base, name="t1"),
          dict(base, name="t2", async_execution=True,
               condition={"check": "contains", "value": "x"})], "async"),
    ]:
        try:
            build_crew({"agents": agents, "tasks": bad}, llm=FakeLLM())
            raise AssertionError("expected ValueError")
        except ValueError as e:
            assert msg in str(e)


def test_run_emits_task_skipped_and_keeps_index_sync():
    store.init()
    spec = {
        "id": "ws-cond-test", "name": "Conditional Crew", "process": "sequential",
        "agents": [{"id": "a1", "role": "Writer", "goal": "g", "backstory": "b"}],
        "tasks": [
            {"agent": "a1", "name": "t1", "description": "d1", "expected_output": "o"},
            # FakeLLM output never contains this -> skipped
            {"agent": "a1", "name": "t2", "description": "d2", "expected_output": "o",
             "condition": {"check": "contains", "value": "zzz-never-present"}},
            {"agent": "a1", "name": "t3", "description": "d3", "expected_output": "o"},
        ],
    }
    rm = RunManager()
    rid = rm.start(spec, dry_run=True)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and rm.get(rid)["status"] == "running":
        time.sleep(0.1)
    rec = rm.get(rid)
    assert rec["status"] == "succeeded"
    skips = [e for e in rec["events"] if e["kind"] == "task.skipped"]
    assert [(e["task_index"], e["task"]) for e in skips] == [(1, "t2")]
    # t3 still correlates to index 2 even though t2 fired no task events
    starts = {e["task_index"] for e in rec["events"] if e["kind"] == "task.started"}
    assert starts == {0, 2}


def test_exporter_emits_conditional_task():
    spec = {
        "name": "Cond Export",
        "agents": [{"id": "a1", "role": "Analyst", "goal": "g", "backstory": "b"}],
        "tasks": [
            {"agent": "a1", "name": "t1", "description": "d1", "expected_output": "o"},
            {"agent": "a1", "name": "t2", "description": "d2", "expected_output": "o",
             "condition": {"check": "regex", "value": "ok"}},
        ],
    }
    files = export_files(spec)
    assert "condition" in files["config/tasks.yaml"]
    assert "ConditionalTask" in files["crew.py"]
    compile(files["crew.py"], "crew.py", "exec")  # generated code parses
    # first-task conditions are invalid and must be dropped on export
    spec["tasks"][0]["condition"] = {"check": "contains", "value": "x"}
    del spec["tasks"][1]["condition"]
    assert "condition" not in export_files(spec)["config/tasks.yaml"]
