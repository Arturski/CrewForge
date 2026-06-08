"""Core unit tests — manifest introspection, adapter, exporter, store."""
import yaml

from server import store
from server.compiler.adapter import build_crew
from server.compiler.exporter import export_files, export_zip
from server.compiler.manifest import build_manifest

SPEC = {
    "id": "ws-test",
    "name": "Test Crew",
    "process": "sequential",
    "agents": [{"id": "a1", "role": "Analyst", "goal": "analyze", "backstory": "bg",
                "verbose": True, "max_iter": 7}],
    "tasks": [{"agent": "a1", "name": "t1", "description": "do the thing",
               "expected_output": "a result", "rules": "- be precise"}],
}


def test_manifest_introspects_models():
    m = build_manifest()
    assert {"Agent", "Task", "Crew"} <= set(m["models"])
    assert m["counts"]["Agent"] > 20
    role = next(f for f in m["models"]["Agent"] if f["name"] == "role")
    assert role["required"] and role["ui"]["control"] == "text"


def test_adapter_builds_crew_with_rules_and_scalars():
    crew = build_crew(SPEC)  # default FakeLLM, no network
    assert len(crew.agents) == 1 and len(crew.tasks) == 1
    # strict rules are compiled into the task description
    assert "STRICT RULES" in crew.tasks[0].description
    assert "be precise" in crew.tasks[0].description
    # scalar advanced field passed through
    assert crew.agents[0].max_iter == 7


def test_exporter_emits_runnable_project():
    files = export_files(SPEC)
    assert "crew.py" in files and "config/agents.yaml" in files
    agents = yaml.safe_load(files["config/agents.yaml"])
    assert agents["a1"]["role"] == "Analyst"
    assert export_zip(SPEC)[:2] == b"PK"  # zip magic


def test_store_workspace_crud():
    store.init()
    ws = {"id": "ws-x", "name": "X", "agents": [], "tasks": []}
    store.save_workspace(ws)
    assert store.get_workspace("ws-x")["name"] == "X"
    ws["name"] = "Y"
    store.save_workspace(ws)
    assert store.get_workspace("ws-x")["name"] == "Y"
    store.delete_workspace("ws-x")
    assert store.get_workspace("ws-x") is None


def test_store_settings_roundtrip():
    store.init()
    store.set_setting("llm", {"model": "openai/gpt-4o-mini"})
    assert store.get_setting("llm")["model"] == "openai/gpt-4o-mini"
