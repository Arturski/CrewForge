"""CrewForge control-plane API + SPA host."""
from __future__ import annotations

import asyncio
import copy
import json
import uuid
from pathlib import Path
from typing import Any

import crewai
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import mcp, registry, store
from . import personas as personas_mod
from . import templates as templates_mod
from .compiler.exporter import export_files, export_zip
from .compiler.manifest import build_manifest
from .compiler.tools import tool_catalog
from .runner import RunManager

app = FastAPI(title="CrewForge", version="0.2.0")
store.init()
runs = RunManager()

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
    return {"tools": tool_catalog() + mcp.mcp_tool_catalog()}


@app.get("/api/personas")
def personas() -> dict[str, Any]:
    return {"personas": personas_mod.PERSONAS}


@app.get("/api/templates")
def templates() -> dict[str, Any]:
    return {"templates": [
        {"id": t["id"], "name": t["name"], "description": t["description"],
         "agents": len(t["spec"]["agents"]), "tasks": len(t["spec"]["tasks"])}
        for t in templates_mod.TEMPLATES
    ]}


# ---- Skill marketplace (official MCP registry) -----------------------------
@app.get("/api/registry")
def registry_search(q: str = "") -> dict[str, Any]:
    return registry.search(q)


# ---- MCP servers (external/local skills) -----------------------------------
@app.get("/api/mcp")
def list_mcp() -> dict[str, Any]:
    return {"servers": mcp.list_servers()}


@app.post("/api/mcp")
async def add_mcp(req: Request) -> dict[str, Any]:
    body = await req.json()
    if body.get("transport", "stdio") == "stdio" and not body.get("command"):
        raise HTTPException(400, "stdio servers need a command")
    if body.get("transport") in ("sse", "streamable-http") and not body.get("url"):
        raise HTTPException(400, "remote servers need a url")
    return mcp.add_server(body)


@app.post("/api/mcp/{server_id}/rescan")
def rescan_mcp(server_id: str) -> dict[str, Any]:
    s = mcp.rescan(server_id)
    if not s:
        raise HTTPException(404, "server not found")
    return s


@app.delete("/api/mcp/{server_id}")
def delete_mcp(server_id: str) -> dict[str, Any]:
    mcp.remove_server(server_id)
    return {"ok": True}


# ---- settings --------------------------------------------------------------
@app.get("/api/settings/llm")
def get_llm_settings() -> dict[str, Any]:
    cfg = store.get_setting("llm") or {}
    return {
        "configured": bool(cfg.get("model")),
        "model": cfg.get("model", ""),
        "base_url": cfg.get("base_url", ""),
        "temperature": cfg.get("temperature"),
        "api_key_set": bool(cfg.get("api_key")),
    }


@app.put("/api/settings/llm")
async def put_llm_settings(req: Request) -> dict[str, Any]:
    body = await req.json()
    cfg = store.get_setting("llm") or {}
    for k in ("model", "base_url", "temperature"):
        if k in body:
            cfg[k] = body[k]
    # only overwrite the key when a non-empty value is sent (keeps existing key on edits)
    if body.get("api_key"):
        cfg["api_key"] = body["api_key"]
    if body.get("clear_api_key"):
        cfg.pop("api_key", None)
    store.set_setting("llm", cfg)
    return {"ok": True}


@app.post("/api/settings/llm/test")
async def test_llm(req: Request) -> dict[str, Any]:
    body = await req.json() if await req.body() else {}
    cfg = store.get_setting("llm") or {}
    model = body.get("model") or cfg.get("model")
    if not model:
        raise HTTPException(400, "set a model first")
    kwargs: dict[str, Any] = {"model": model}
    api_key = body.get("api_key") or cfg.get("api_key")
    base_url = body.get("base_url") or cfg.get("base_url")
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["base_url"] = base_url
    try:
        from crewai import LLM
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
            terminal = rec and rec.get("status") in ("succeeded", "failed")
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
