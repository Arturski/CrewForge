"""CrewForge control-plane API + SPA host."""
from __future__ import annotations

import asyncio
import base64
import copy
import json
import uuid
from pathlib import Path
from typing import Any

import crewai
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import batches as batches_mod
from . import builtin_tools, mcp, registry, store
from . import evals as evals_mod
from . import knowledge as knowledge_mod
from . import llms as llms_mod
from . import schedules as schedules_mod
from . import templates as templates_mod
from .compiler.exporter import export_files, export_zip
from .compiler.manifest import build_manifest
from .compiler.tools import tool_catalog
from .runner import RunManager

app = FastAPI(title="CrewForge", version="0.2.0")
store.init()
runs = RunManager()
schedules_mod.start(runs)

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


def _summary(ws: dict[str, Any]) -> dict[str, Any]:
    return {"id": ws["id"], "name": ws.get("name", "Untitled"),
            "description": ws.get("description", ""),
            "agents": len(ws.get("agents", [])), "tasks": len(ws.get("tasks", []))}


# ---- meta ------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "crewai_version": crewai.__version__, "version": app.version}


@app.get("/api/manifest")
def manifest() -> dict[str, Any]:
    return build_manifest()


@app.get("/api/tools")
def tools() -> dict[str, Any]:
    out = []
    for t in tool_catalog():
        st = builtin_tools.status(t["name"])
        desc = builtin_tools.describe(t["name"]) or {}
        out.append({**t, **st, "env_vars": desc.get("env_vars") or [],
                    "params": desc.get("params") or []})
    return {"tools": out + mcp.mcp_tool_catalog()}


@app.get("/api/tools/builtin/{name}")
def get_builtin_tool(name: str) -> dict[str, Any]:
    desc = builtin_tools.describe(name)
    if desc is None:
        raise HTTPException(404, "tool not found")
    return {**desc, "config": builtin_tools.get_config(name),
            **builtin_tools.status(name)}


@app.put("/api/tools/builtin/{name}/config")
async def set_builtin_tool_config(name: str, req: Request) -> dict[str, Any]:
    if builtin_tools.describe(name) is None:
        raise HTTPException(404, "tool not found")
    b = await req.json() if await req.body() else {}
    builtin_tools.set_config(name, b.get("args"), b.get("env"))
    return {"config": builtin_tools.get_config(name), **builtin_tools.status(name)}


@app.delete("/api/tools/builtin/{name}/config")
def delete_builtin_tool_config(name: str) -> dict[str, Any]:
    builtin_tools.delete_config(name)
    return {"ok": True}


@app.get("/api/personas")
def personas() -> dict[str, Any]:
    return {"personas": store.list_personas()}


@app.post("/api/personas")
async def create_persona(req: Request) -> dict[str, Any]:
    p = await req.json()
    if not p.get("id"):
        p["id"] = f"persona-{uuid.uuid4().hex[:8]}"
    p.setdefault("tags", [])
    p.setdefault("suggested_tools", [])
    return store.save_persona(p)


@app.delete("/api/personas/{persona_id}")
def delete_persona(persona_id: str) -> dict[str, Any]:
    store.delete_persona(persona_id)
    return {"ok": True}


@app.get("/api/templates")
def templates() -> dict[str, Any]:
    return {"templates": [
        {"id": t["id"], "name": t["name"], "description": t["description"],
         "agents": len(t["spec"]["agents"]), "tasks": len(t["spec"]["tasks"])}
        for t in templates_mod.TEMPLATES
    ]}


# ---- Knowledge bases -------------------------------------------------------
@app.get("/api/knowledge")
def list_knowledge() -> dict[str, Any]:
    kbs = knowledge_mod.list_kbs()
    for kb in kbs:
        kb["stats"] = {"sources": len(store.list_sources(kb["id"])), "chunks": store.count_chunks(kb["id"])}
    return {"knowledge_bases": kbs}


@app.post("/api/knowledge")
async def create_knowledge(req: Request) -> dict[str, Any]:
    b = await req.json() if await req.body() else {}
    return knowledge_mod.create_kb(b.get("name", ""), b.get("description", ""))


@app.get("/api/knowledge/{kb_id}")
def get_knowledge(kb_id: str) -> dict[str, Any]:
    kb = knowledge_mod.get_kb(kb_id)
    if not kb:
        raise HTTPException(404, "knowledge base not found")
    return kb


@app.delete("/api/knowledge/{kb_id}")
def delete_knowledge(kb_id: str) -> dict[str, Any]:
    knowledge_mod.delete_kb(kb_id)
    return {"ok": True}


@app.post("/api/knowledge/{kb_id}/sources")
async def add_kb_source(kb_id: str, req: Request) -> dict[str, Any]:
    if not store.get_kb(kb_id):
        raise HTTPException(404, "knowledge base not found")
    b = await req.json()
    kind = b.get("kind")
    if kind == "file":
        content = base64.b64decode((b.get("content_b64") or "").split(",")[-1] or "")
        return knowledge_mod.add_source(kb_id, "file", filename=b.get("filename"), content=content)
    if kind in ("url", "github"):
        url = (b.get("url") or "").strip()
        if not url:
            raise HTTPException(400, "url is required")
        return knowledge_mod.add_source(kb_id, kind, url=url, crawl=bool(b.get("crawl")),
                                        max_pages=min(int(b.get("max_pages") or 30), 100))
    return knowledge_mod.add_source(kb_id, "text", text=b.get("text", ""))


@app.post("/api/knowledge/{kb_id}/search")
async def search_knowledge(kb_id: str, req: Request) -> dict[str, Any]:
    b = await req.json() if await req.body() else {}
    results = knowledge_mod.search(kb_id, b.get("q") or b.get("query", ""))
    facts = knowledge_mod.related_facts(kb_id, [r["chunk_id"] for r in results])
    return {"results": results, "facts": facts}


@app.get("/api/knowledge/{kb_id}/graph")
def get_knowledge_graph(kb_id: str) -> dict[str, Any]:
    if not store.get_kb(kb_id):
        raise HTTPException(404, "knowledge base not found")
    return knowledge_mod.graph_overview(kb_id)


@app.post("/api/knowledge/{kb_id}/graph/build")
def build_knowledge_graph(kb_id: str) -> dict[str, Any]:
    try:
        return knowledge_mod.build_graph(kb_id)
    except KeyError:
        raise HTTPException(404, "knowledge base not found") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


# ---- Schedules + webhook triggers ------------------------------------------
@app.get("/api/schedules")
def list_schedules(workspace_id: str | None = None) -> dict[str, Any]:
    items = store.list_schedules(workspace_id)
    names = {w["id"]: w.get("name", "") for w in store.list_workspaces()}
    for s in items:
        s["workspace_name"] = names.get(s["workspace_id"], "(deleted)")
    return {"schedules": items}


@app.post("/api/schedules")
async def create_schedule(req: Request) -> dict[str, Any]:
    b = await req.json()
    if not store.get_workspace(b.get("workspace_id", "")):
        raise HTTPException(404, "workspace not found")
    try:
        return schedules_mod.create(b["workspace_id"], b.get("cron", ""),
                                    inputs=b.get("inputs"), dry_run=bool(b.get("dry_run")),
                                    enabled=b.get("enabled", True))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@app.put("/api/schedules/{sid}")
async def update_schedule(sid: str, req: Request) -> dict[str, Any]:
    b = await req.json()
    try:
        s = schedules_mod.update(sid, b)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    if not s:
        raise HTTPException(404, "schedule not found")
    return s


@app.delete("/api/schedules/{sid}")
def delete_schedule(sid: str) -> dict[str, Any]:
    store.delete_schedule(sid)
    return {"ok": True}


@app.post("/api/workspaces/{ws_id}/hook")
def create_hook(ws_id: str) -> dict[str, Any]:
    """Generate (or rotate) the workspace's webhook token."""
    ws = store.get_workspace(ws_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    ws["hook_token"] = uuid.uuid4().hex
    store.save_workspace(ws)
    return {"url": f"/api/hooks/{ws_id}/{ws['hook_token']}"}


@app.delete("/api/workspaces/{ws_id}/hook")
def delete_hook(ws_id: str) -> dict[str, Any]:
    ws = store.get_workspace(ws_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    ws.pop("hook_token", None)
    store.save_workspace(ws)
    return {"ok": True}


@app.post("/api/hooks/{ws_id}/{token}")
async def webhook_trigger(ws_id: str, token: str, req: Request) -> dict[str, Any]:
    """Public trigger: start a run with optional {inputs, dry_run} JSON body."""
    ws = store.get_workspace(ws_id)
    if not ws or not ws.get("hook_token") or ws["hook_token"] != token:
        raise HTTPException(404, "unknown hook")  # don't reveal which part failed
    if not ws.get("agents") or not ws.get("tasks"):
        raise HTTPException(400, "workspace needs at least one agent and one task")
    b = await req.json() if await req.body() else {}
    inputs = {i["name"]: i.get("default") or "" for i in (ws.get("inputs") or []) if i.get("name")}
    inputs.update({k: str(v) for k, v in (b.get("inputs") or {}).items()})
    run_id = runs.start(ws, dry_run=bool(b.get("dry_run")), inputs=inputs, trigger="webhook")
    return {"run_id": run_id, "workspace_id": ws_id}


# ---- Batch runs (one workflow over many input rows) ------------------------
@app.get("/api/batches")
def list_batches(workspace_id: str | None = None) -> dict[str, Any]:
    items = batches_mod.list_batches(workspace_id)
    names = {w["id"]: w.get("name", "") for w in store.list_workspaces()}
    for b in items:
        b["workspace_name"] = names.get(b["workspace_id"], "(deleted)")
    return {"batches": items}


@app.get("/api/batches/{bid}")
def get_batch(bid: str) -> dict[str, Any]:
    batch = batches_mod.get(bid)
    if not batch:
        raise HTTPException(404, "batch not found")
    batch["runs"] = [r for r in (store.get_run(rid) for rid in batch.get("run_ids", [])) if r]
    return batch


@app.post("/api/batches")
async def create_batch(req: Request) -> dict[str, Any]:
    b = await req.json()
    ws = store.get_workspace(b.get("workspace_id", ""))
    if not ws:
        raise HTTPException(404, "workspace not found")
    if not ws.get("agents") or not ws.get("tasks"):
        raise HTTPException(400, "workspace needs at least one agent and one task")
    input_names = [i["name"] for i in (ws.get("inputs") or []) if i.get("name")]
    rows = b.get("rows")
    try:
        if not rows and b.get("csv"):
            rows = batches_mod.rows_from_csv(b["csv"], input_names)
        rows = [{k: str(v) for k, v in (row or {}).items()} for row in (rows or [])]
        return batches_mod.start(runs, ws, rows, dry_run=bool(b.get("dry_run", True)),
                                 name=b.get("name"))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@app.post("/api/batches/{bid}/cancel")
def cancel_batch(bid: str) -> dict[str, Any]:
    if not batches_mod.cancel(bid):
        raise HTTPException(404, "no running batch with that id")
    return {"ok": True}


# ---- Evals (run a workflow over a test set, score the outputs) -------------
@app.get("/api/evals")
def list_evals(workspace_id: str | None = None) -> dict[str, Any]:
    items = evals_mod.list_evals(workspace_id)
    names = {w["id"]: w.get("name", "") for w in store.list_workspaces()}
    for e in items:
        e["workspace_name"] = names.get(e["workspace_id"], "(deleted)")
    return {"evals": items}


@app.get("/api/evals/{eid}")
def get_eval(eid: str) -> dict[str, Any]:
    ev = evals_mod.get(eid)
    if not ev:
        raise HTTPException(404, "eval not found")
    return ev


@app.post("/api/evals/run")
async def run_eval(req: Request) -> dict[str, Any]:
    b = await req.json()
    ws = store.get_workspace(b.get("workspace_id", ""))
    if not ws:
        raise HTTPException(404, "workspace not found")
    if not ws.get("agents") or not ws.get("tasks"):
        raise HTTPException(400, "workspace needs at least one agent and one task")
    # Cases come from the request, else fall back to the spec's saved test set.
    cases = b.get("cases") or ws.get("eval_cases") or []
    try:
        return evals_mod.start(runs, ws, cases, dry_run=bool(b.get("dry_run", True)),
                               name=b.get("name"))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@app.post("/api/evals/{eid}/cancel")
def cancel_eval(eid: str) -> dict[str, Any]:
    if not evals_mod.cancel(eid):
        raise HTTPException(404, "no running eval with that id")
    return {"ok": True}


# ---- Skill marketplace (official MCP registry) -----------------------------
@app.get("/api/registry")
def registry_search(q: str = "") -> dict[str, Any]:
    return registry.search(q)


# ---- MCP servers (external/local skills) -----------------------------------
@app.get("/api/mcp")
def list_mcp() -> dict[str, Any]:
    return {"servers": [mcp.public(s) for s in mcp.list_servers()]}


@app.post("/api/mcp")
async def add_mcp(req: Request) -> dict[str, Any]:
    body = await req.json()
    if body.get("transport", "stdio") == "stdio" and not body.get("command"):
        raise HTTPException(400, "stdio servers need a command")
    if body.get("transport") in ("sse", "streamable-http") and not body.get("url"):
        raise HTTPException(400, "remote servers need a url")
    return mcp.public(mcp.add_server(body))


@app.post("/api/mcp/{server_id}/rescan")
def rescan_mcp(server_id: str) -> dict[str, Any]:
    s = mcp.rescan(server_id)
    if not s:
        raise HTTPException(404, "server not found")
    return mcp.public(s)


@app.delete("/api/mcp/{server_id}")
def delete_mcp(server_id: str) -> dict[str, Any]:
    mcp.remove_server(server_id)
    return {"ok": True}


# ---- LLM connections (multiple, selectable per workflow/agent) -------------
@app.get("/api/llms")
def list_llms() -> dict[str, Any]:
    return llms_mod.list_public()


@app.post("/api/llms")
async def save_llm(req: Request) -> dict[str, Any]:
    body = await req.json()
    if not body.get("model"):
        raise HTTPException(400, "model is required")
    return llms_mod.upsert(body)


@app.delete("/api/llms/{llm_id}")
def remove_llm(llm_id: str) -> dict[str, Any]:
    llms_mod.delete(llm_id)
    return {"ok": True}


@app.put("/api/llms/default")
async def set_default_llm(req: Request) -> dict[str, Any]:
    body = await req.json()
    llms_mod.set_default(body.get("id", ""))
    return {"ok": True}


def _key_for(b: dict[str, Any]) -> str | None:
    key = b.get("api_key")
    if not key:
        cfg = llms_mod.resolve(b.get("id"))  # specific connection, else default
        key = cfg.get("api_key") if cfg else None
    return key


@app.post("/api/llms/models")
async def provider_models(req: Request) -> dict[str, Any]:
    from . import providers
    b = await req.json() if await req.body() else {}
    try:
        return {"models": providers.fetch_models(b.get("provider", "openai"), b.get("base_url", ""), _key_for(b))}
    except Exception as e:  # noqa: BLE001
        return {"models": [], "error": f"{type(e).__name__}: {e}"[:200]}


@app.post("/api/llms/test")
async def test_llm(req: Request) -> dict[str, Any]:
    from crewai import LLM
    b = await req.json() if await req.body() else {}
    model, base_url, key = b.get("model"), b.get("base_url", ""), b.get("api_key")
    if (not model or not key) and b.get("id"):
        cfg = llms_mod.resolve(b["id"]) or {}
        model = model or cfg.get("model")
        base_url = base_url or cfg.get("base_url", "")
        key = key or cfg.get("api_key")
    if not model:
        raise HTTPException(400, "set a model first")
    kwargs: dict[str, Any] = {"model": model}
    if key:
        kwargs["api_key"] = key
    if base_url:
        kwargs["base_url"] = base_url
    try:
        out = LLM(**kwargs).call("Reply with exactly the word: ok")
        return {"ok": True, "sample": str(out)[:120]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}


# ---- workspaces (CRUD) -----------------------------------------------------
@app.get("/api/workspaces")
def list_workspaces() -> dict[str, Any]:
    return {"workspaces": [_summary(w) for w in store.list_workspaces()]}


@app.post("/api/workspaces")
async def create_workspace(req: Request) -> dict[str, Any]:
    body = await req.json() if await req.body() else {}
    ws_id = f"ws-{uuid.uuid4().hex[:8]}"
    template = templates_mod.get_template(body["template"]) if body.get("template") else None
    if template:
        ws = copy.deepcopy(template["spec"])
        ws["id"] = ws_id
        ws["name"] = body.get("name") or template["name"]
        ws.setdefault("description", template["description"])
    else:
        ws = {
            "id": ws_id,
            "name": body.get("name", "Untitled Crew"),
            "description": body.get("description", ""),
            "process": "sequential",
            "agents": [],
            "tasks": [],
        }
    return store.save_workspace(ws)


@app.post("/api/workspaces/{ws_id}/duplicate")
def duplicate_workspace(ws_id: str) -> dict[str, Any]:
    ws = store.get_workspace(ws_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    dup = copy.deepcopy(ws)
    dup["id"] = f"ws-{uuid.uuid4().hex[:8]}"
    dup["name"] = f"{ws.get('name', 'Crew')} (copy)"
    return store.save_workspace(dup)


@app.get("/api/workspaces/{workspace_id}")
def get_workspace(workspace_id: str) -> dict[str, Any]:
    ws = store.get_workspace(workspace_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    return ws


@app.put("/api/workspaces/{workspace_id}")
async def update_workspace(workspace_id: str, req: Request) -> dict[str, Any]:
    if not store.get_workspace(workspace_id):
        raise HTTPException(404, "workspace not found")
    ws = await req.json()
    ws["id"] = workspace_id
    return store.save_workspace(ws)


@app.delete("/api/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str) -> dict[str, Any]:
    store.delete_workspace(workspace_id)
    return {"ok": True}


# ---- export ----------------------------------------------------------------
@app.get("/api/workspaces/{workspace_id}/code")
def workspace_code(workspace_id: str) -> dict[str, Any]:
    ws = store.get_workspace(workspace_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    return {"files": export_files(ws)}


@app.get("/api/workspaces/{workspace_id}/export")
def workspace_export(workspace_id: str) -> Response:
    ws = store.get_workspace(workspace_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    data = export_zip(ws)
    from .compiler.exporter import _slug
    return Response(content=data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{_slug(ws["name"])}.zip"'})


# ---- runs ------------------------------------------------------------------
@app.post("/api/runs")
async def start_run(req: Request) -> dict[str, Any]:
    body = await req.json() if await req.body() else {}
    ws = store.get_workspace(body.get("workspace_id", ""))
    if not ws:
        raise HTTPException(404, "workspace not found")
    if not ws.get("agents") or not ws.get("tasks"):
        raise HTTPException(400, "workspace needs at least one agent and one task")
    run_id = runs.start(ws, dry_run=body.get("dry_run", True), inputs=body.get("inputs") or {})
    return {"run_id": run_id, "workspace_id": ws["id"]}


@app.get("/api/runs")
def list_runs() -> dict[str, Any]:
    return {"runs": runs.list_runs()}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    rec = runs.get(run_id)
    if not rec:
        raise HTTPException(404, "run not found")
    return runs._public(rec)


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict[str, Any]:
    if not runs.get(run_id):
        raise HTTPException(404, "run not found")
    return {"ok": runs.cancel(run_id)}


@app.post("/api/runs/{run_id}/input")
async def run_input(run_id: str, req: Request) -> dict[str, Any]:
    """Deliver a HITL decision: {decision: approve|reject, edit?, feedback?}."""
    if not runs.get(run_id):
        raise HTTPException(404, "run not found")
    b = await req.json() if await req.body() else {}
    if b.get("decision") not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    if not runs.hitl_decision(run_id, b):
        raise HTTPException(409, "run is not waiting for input")
    return {"ok": True}


@app.get("/api/runs/{run_id}/events")
def run_events(run_id: str, since: int = 0) -> dict[str, Any]:
    if not runs.get(run_id):
        raise HTTPException(404, "run not found")
    return {"events": runs.events_since(run_id, since)}


@app.get("/api/runs/{run_id}/events/stream")
async def run_events_stream(run_id: str, request: Request) -> StreamingResponse:
    if not runs.get(run_id):
        raise HTTPException(404, "run not found")
    last = int(request.headers.get("Last-Event-ID", "0"))

    async def gen():
        nonlocal last
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            new = runs.events_since(run_id, last)
            for evt in new:
                last = evt["seq"] + 1
                yield f"id: {last}\ndata: {json.dumps(evt)}\n\n"
            rec = runs.get(run_id)
            terminal = rec and rec.get("status") in ("succeeded", "failed", "cancelled")
            if terminal and not runs.events_since(run_id, last):
                yield f"event: end\ndata: {json.dumps({'status': rec['status']})}\n\n"
                break
            idle = idle + 1 if not new else 0
            if idle and idle % 30 == 0:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---- SPA host --------------------------------------------------------------
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):  # noqa: ANN201
        if full_path.startswith("api/"):
            raise HTTPException(404)
        index = WEB_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(404)
else:
    @app.get("/")
    def root() -> JSONResponse:
        return JSONResponse({"service": "CrewForge", "ui": "not built",
                             "hint": "npm --prefix web run build"})
