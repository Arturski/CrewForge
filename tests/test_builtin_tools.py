"""Built-in tool config + live instantiation. No network — tools are only constructed."""
from server import builtin_tools, store
from server.compiler.exporter import export_files


def test_describe_params_and_env():
    d = builtin_tools.describe("SerperDevTool")
    assert {"name": "SERPER_API_KEY", "required": True} in d["env_vars"]
    names = {p["name"] for p in d["params"]}
    assert "n_results" in names
    assert builtin_tools.describe("NotARealTool") is None


def test_config_roundtrip_encrypts_and_masks():
    store.init()
    builtin_tools.set_config("SerperDevTool", {"n_results": 5}, {"SERPER_API_KEY": "sk-test-1"})
    try:
        masked = builtin_tools.get_config("SerperDevTool")
        assert masked["env"] == {"SERPER_API_KEY": "•••"}
        raw = store.get_setting("tool_configs")["SerperDevTool"]["env"]["SERPER_API_KEY"]
        assert "sk-test-1" not in raw  # encrypted at rest
        assert builtin_tools.get_config("SerperDevTool", masked=False)["env"]["SERPER_API_KEY"] == "sk-test-1"
        # masked placeholder on re-save keeps the stored secret
        builtin_tools.set_config("SerperDevTool", {"n_results": 7}, {"SERPER_API_KEY": "•••"})
        assert builtin_tools.get_config("SerperDevTool", masked=False)["env"]["SERPER_API_KEY"] == "sk-test-1"
        assert builtin_tools.status("SerperDevTool") == {"configured": True, "missing_env": []}
    finally:
        builtin_tools.delete_config("SerperDevTool")
    assert builtin_tools.status("SerperDevTool")["configured"] is False


def test_instantiate_ready_vs_missing_key(monkeypatch):
    store.init()
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    tools, errors = builtin_tools.instantiate(["FileReadTool", "BraveSearchTool", "NotARealTool"])
    assert "FileReadTool" in tools  # keyless tool constructs fine
    assert "BraveSearchTool" in errors and "BRAVE_API_KEY" in errors["BraveSearchTool"]
    assert "NotARealTool" not in tools and "NotARealTool" not in errors


def test_export_instantiates_builtin_tools():
    store.init()
    builtin_tools.set_config("SerperDevTool", {"n_results": 3}, {"SERPER_API_KEY": "sk-x"})
    try:
        files = export_files({
            "name": "Tooled",
            "agents": [{"id": "a1", "role": "R", "goal": "g", "backstory": "b",
                        "tools": ["SerperDevTool"]}],
            "tasks": [{"agent": "a1", "name": "t", "description": "d", "expected_output": "o"}],
        })
        assert "_build_tools" in files["crew.py"]
        compile(files["crew.py"], "crew.py", "exec")
        assert "n_results: 3" in files["config/tools.yaml"]
        assert "sk-x" not in str(files)  # secrets never exported
    finally:
        builtin_tools.delete_config("SerperDevTool")
