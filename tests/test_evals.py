"""Evals: output scoring (all check types incl. judge), the driver, aggregate, cancel."""
import time

import pytest

from server import evals, store


class _StubRuns:
    """Stands in for RunManager. Returns canned per-run results so scoring is
    deterministic; hang=True keeps runs 'running' to exercise eval cancel."""
    def __init__(self, *, result="the answer is 42", hang=False):
        self.result = result
        self.hang = hang
        self.runs: dict[str, dict] = {}
        self.started: list[dict] = []

    def start(self, spec, *, dry_run=True, inputs=None, trigger="manual",
              batch_id=None, batch_index=None):
        rid = f"run-{len(self.runs) + 1}"
        self.started.append({"id": rid, "inputs": inputs, "trigger": trigger})
        self.runs[rid] = {"id": rid, "status": "running" if self.hang else "succeeded",
                          "result": self.result, "cost": 0.02, "tokens": 50}
        return rid

    def get(self, rid):
        return self.runs.get(rid)

    def cancel(self, rid):
        r = self.runs.get(rid)
        if r and r["status"] == "running":
            r["status"] = "cancelled"
        return True


class _FakeJudge:
    def __init__(self, verdict="PASS — looks right"):
        self.verdict = verdict
        self.calls = 0

    def call(self, prompt):
        self.calls += 1
        return self.verdict


def _wait(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def _spec():
    return {"id": "ws-eval", "name": "QA",
            "agents": [{"id": "a1", "role": "R", "goal": "g", "backstory": "b"}],
            "tasks": [{"agent": "a1", "name": "t", "description": "d", "expected_output": "o"}],
            "inputs": [{"name": "q", "default": "?"}]}


# -- scoring -----------------------------------------------------------------
def test_score_output_assertion_checks():
    text = "The Answer is 42, not 7."
    checks = [
        {"type": "contains", "value": "answer"},          # case-insensitive default → ok
        {"type": "not_contains", "value": "purple"},      # ok
        {"type": "regex", "value": r"\d+"},               # ok
        {"type": "equals", "value": "the answer is 42, not 7."},  # ok (trim+lower)
    ]
    res = evals.score_output(text, checks)
    assert res["passed"] is True
    assert [r["ok"] for r in res["results"]] == [True, True, True, True]


def test_score_output_failure_and_case_sensitivity():
    res = evals.score_output("hello world", [
        {"type": "contains", "value": "Goodbye"},
        {"type": "contains", "value": "Hello", "case_sensitive": True},  # fails (cap H)
    ])
    assert res["passed"] is False
    assert [r["ok"] for r in res["results"]] == [False, False]


def test_score_output_bad_regex_is_reported_not_raised():
    res = evals.score_output("x", [{"type": "regex", "value": "([unclosed"}])
    assert res["passed"] is False
    assert "bad regex" in res["results"][0]["detail"]


def test_score_output_no_checks_passes():
    assert evals.score_output("anything", [])["passed"] is True


def test_judge_check_requires_model_else_fails_cleanly():
    # no judge available (dry-run) → judge check fails with a helpful detail
    res = evals.score_output("output", [{"type": "judge", "value": "is correct"}], judge=None)
    assert res["passed"] is False
    assert "live model" in res["results"][0]["detail"]
    # with a judge that says PASS
    res2 = evals.score_output("output", [{"type": "judge", "value": "is correct"}], judge=_FakeJudge())
    assert res2["passed"] is True
    # judge that says FAIL
    res3 = evals.score_output("output", [{"type": "judge", "value": "is correct"}],
                              judge=_FakeJudge("FAIL — missing detail"))
    assert res3["passed"] is False


# -- driver ------------------------------------------------------------------
def test_eval_runs_cases_scores_and_aggregates():
    store.init()
    runs = _StubRuns(result="the answer is 42")
    cases = [
        {"inputs": {"q": "a"}, "checks": [{"type": "contains", "value": "42"}]},        # pass
        {"inputs": {"q": "b"}, "checks": [{"type": "contains", "value": "99"}]},        # fail
        {"inputs": {"q": "c"}, "checks": [{"type": "regex", "value": r"answer"}]},      # pass
    ]
    ev = evals.start(runs, _spec(), cases, dry_run=True)
    assert _wait(lambda: (store.get_eval(ev["id"]) or {}).get("status") == "done")
    final = store.get_eval(ev["id"])
    assert final["total"] == 3 and final["finished"] == 3
    assert final["passed"] == 2 and final["failed"] == 1
    assert final["score"] == pytest.approx(2 / 3, abs=1e-3)
    assert final["cost"] == pytest.approx(0.06) and final["tokens"] == 150
    assert [c["passed"] for c in final["cases"]] == [True, False, True]
    # inputs merged with defaults, eval trigger set
    assert runs.started[0]["inputs"]["q"] == "a"
    assert all(s["trigger"] == f"eval:{ev['id']}" for s in runs.started)
    store.delete_eval(ev["id"])


def test_eval_rejects_empty_and_unknown_check():
    store.init()
    with pytest.raises(ValueError):
        evals.start(_StubRuns(), _spec(), [], dry_run=True)
    with pytest.raises(ValueError):
        evals.start(_StubRuns(), _spec(),
                    [{"inputs": {}, "checks": [{"type": "bogus", "value": "x"}]}], dry_run=True)


def test_eval_cancel_stops_remaining_cases():
    store.init()
    runs = _StubRuns(hang=True)
    cases = [{"inputs": {}, "checks": []} for _ in range(3)]
    ev = evals.start(runs, _spec(), cases, dry_run=True)
    assert _wait(lambda: len(runs.started) >= 1)
    assert evals.cancel(ev["id"]) is True
    assert _wait(lambda: (store.get_eval(ev["id"]) or {}).get("status") == "cancelled")
    assert len(runs.started) < 3
    assert evals.cancel("eval-nope") is False
    store.delete_eval(ev["id"])
