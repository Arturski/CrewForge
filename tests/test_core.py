"""Core unit tests — manifest introspection, adapter, exporter, store."""
import yaml
from crewai.llms.base_llm import BaseLLM

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


class _StubLLM(BaseLLM):
    def __init__(self):
        super().__init__(model="stub")

    def call(self, *a, **k):
        return "ok"

    def supports_function_calling(self):
        return False


def test_vector_chunk_and_rank():
    from server.knowledge import vector
    chunks = vector.chunk(" ".join(["word"] * 500), words=220, overlap=20)
    assert len(chunks) >= 2  # long text splits into multiple chunks
    items = [{"id": "a", "emb": [1.0, 0.0, 0.0]}, {"id": "b", "emb": [0.0, 1.0, 0.0]}]
    top = vector.rank([0.9, 0.1, 0.0], items, k=1)  # closest to 'a'
    assert top[0]["id"] == "a" and top[0]["score"] > 0.9


def test_knowledge_kb_crud():
    store.init()
    kb = {"id": "kb-test", "name": "T", "stats": {}}
    store.save_kb(kb)
    assert store.get_kb("kb-test")["name"] == "T"
    store.delete_kb("kb-test")
    assert store.get_kb("kb-test") is None


def test_adapter_phase3_features():
    spec = {
        "agents": [{"id": "a1", "role": "Analyst", "goal": "g", "backstory": "b"}],
        "tasks": [
            {"agent": "a1", "name": "t1", "description": "d1", "expected_output": "o",
             "async_execution": True},
            {"agent": "a1", "name": "t2", "description": "d2", "expected_output": "o",
             "output_schema": [{"name": "title", "type": "string"}, {"name": "score", "type": "integer"}]},
        ],
    }
    per_agent = _StubLLM()
    crew = build_crew(spec, llm=_StubLLM(), agent_llms={"a1": per_agent})
    assert crew.agents[0].llm is per_agent          # per-agent override applied
    assert crew.tasks[0].async_execution is True     # async honored
    assert crew.tasks[1].output_pydantic is not None  # structured output (live path)
    fields = crew.tasks[1].output_pydantic.model_fields
    assert set(fields) == {"title", "score"}
