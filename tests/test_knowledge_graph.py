"""Knowledge Phase 3: Kuzu graph extraction + hybrid retrieval (no network, no model)."""
import time

from server import knowledge, store
from server.knowledge import extract, graph, vector


def _wait_graph(kb_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = (store.get_kb(kb_id) or {}).get("graph") or {}
        if state.get("status") in ("ready", "error"):
            return state
        time.sleep(0.05)
    raise AssertionError("graph build did not finish")


class _StubExtractorLLM:
    """Returns canned extractions; counts calls to prove incremental rebuilds."""
    def __init__(self):
        self.calls = 0

    def call(self, prompt: str) -> str:
        self.calls += 1
        if "Bob works" in prompt:
            return ('```json\n{"entities": [{"name": "Bob", "type": "person"}, '
                    '{"name": "Acme Corp", "type": "org"}], "relations": '
                    '[{"source": "Bob", "label": "works at", "target": "Acme Corp"}]}\n```')
        return ('{"entities": [{"name": "Acme Corp", "type": "org"}, '
                '{"name": "rockets", "type": "product"}], "relations": '
                '[{"source": "Acme Corp", "label": "makes", "target": "rockets"}]}')


def test_extract_parse_tolerates_fences_and_prose():
    fenced = '```json\n{"entities": [{"name": "X", "type": "org"}], "relations": []}\n```'
    assert extract.parse(fenced)["entities"] == [{"name": "X", "type": "org"}]
    prose = 'Sure! Here you go: {"entities": [{"name": "Y"}], "relations": [{"source": "Y", "label": "is", "target": "Z"}]} hope that helps'
    out = extract.parse(prose)
    assert out["entities"][0]["name"] == "Y" and out["relations"][0]["target"] == "Z"
    assert extract.parse("no json here") == {"entities": [], "relations": []}
    assert extract.parse('{"entities": "bad shape"}') == {"entities": [], "relations": []}


def test_graph_roundtrip_and_directed_facts():
    store.init()
    kb_id = "kb-graphtest"
    graph.add_chunk(kb_id, "c1", "doc1",
                    [{"name": "Bob", "type": "person"}, {"name": "Acme Corp", "type": "org"}],
                    [{"source": "Bob", "label": "works at", "target": "Acme Corp"}])
    # Upsert is idempotent: same chunk again must not duplicate anything.
    graph.add_chunk(kb_id, "c1", "doc1",
                    [{"name": "Bob", "type": "person"}],
                    [{"source": "Bob", "label": "works at", "target": "Acme Corp"}])
    assert graph.stats(kb_id) == {"entities": 2, "relations": 1, "chunks": 1}
    assert graph.graphed_chunks(kb_id) == {"c1"}

    ov = graph.overview(kb_id)
    assert {e["label"] for e in ov["entities"]} == {"Bob", "Acme Corp"}
    assert ov["relations"] == [{"source": "bob", "label": "works at", "target": "acme corp"}]

    facts = graph.related_facts(kb_id, ["c1"])
    assert facts == [{"source": "Bob", "label": "works at", "target": "Acme Corp"}]  # directed, deduped
    assert graph.related_facts(kb_id, ["missing"]) == []

    graph.delete(kb_id)
    assert not graph.exists(kb_id)
    assert graph.stats(kb_id) == {"entities": 0, "relations": 0, "chunks": 0}


def test_build_graph_incremental_with_stub_llm(monkeypatch):
    store.init()
    from server import llms
    stub = _StubExtractorLLM()
    monkeypatch.setattr(llms, "build", lambda *a, **k: stub)

    kb = knowledge.create_kb("Graph KB")
    store.add_chunks(kb["id"], "src1", [
        ("c1", "Bob works at Acme Corp.", [1.0, 0.0], {"source": "doc1"}),
        ("c2", "Acme Corp makes rockets.", [0.0, 1.0], {"source": "doc1"}),
    ])
    knowledge.build_graph(kb["id"])
    state = _wait_graph(kb["id"])
    assert state["status"] == "ready" and state["entities"] == 3 and state["chunks"] == 2
    assert stub.calls == 2

    # Rebuild only touches new chunks: none were added, so no LLM calls.
    knowledge.build_graph(kb["id"])
    assert _wait_graph(kb["id"])["status"] == "ready"
    assert stub.calls == 2

    overview = knowledge.graph_overview(kb["id"])
    assert overview["graph"]["status"] == "ready"
    assert len(overview["entities"]) == 3

    knowledge.delete_kb(kb["id"])
    assert not graph.exists(kb["id"])


def test_build_graph_requires_provider(monkeypatch):
    store.init()
    from server import llms
    monkeypatch.setattr(llms, "build", lambda *a, **k: None)
    kb = knowledge.create_kb("No provider")
    try:
        knowledge.build_graph(kb["id"])
        raise AssertionError("expected ValueError without a configured LLM")
    except ValueError:
        pass
    finally:
        knowledge.delete_kb(kb["id"])


def test_knowledge_tool_hybrid_output(monkeypatch):
    store.init()
    kb = knowledge.create_kb("Hybrid KB")
    store.add_chunks(kb["id"], "src1", [
        ("c1", "Bob works at Acme Corp.", [1.0, 0.0], {"source": "doc1"}),
    ])
    graph.add_chunk(kb["id"], "c1", "doc1",
                    [{"name": "Bob", "type": "person"}, {"name": "Acme Corp", "type": "org"}],
                    [{"source": "Bob", "label": "works at", "target": "Acme Corp"}])
    monkeypatch.setattr(vector, "embed", lambda texts, **k: [[1.0, 0.0] for _ in texts])

    from server.compiler.knowledge_tool import make_tool
    out = make_tool(kb)._run("where does bob work?")
    assert "Bob works at Acme Corp." in out
    assert "Related facts from the knowledge graph" in out
    assert "Bob — works at — Acme Corp" in out

    knowledge.delete_kb(kb["id"])
