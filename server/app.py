"""CrewForge control-plane API + SPA host."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import crewai
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .compiler.manifest import build_manifest
from .runner import RunManager
from .seed import WORKSPACES

app = FastAPI(title="CrewForge", version="0.1.0")
runs = RunManager()

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


# ---- API -------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "crewai_version": crewai.__version__, "version": app.version}


@app.get("/api/manifest")
def manifest() -> dict[str, Any]:
    return build_manifest()


@app.get("/api/workspaces")
def list_workspaces() -> dict[str, Any]:
    return {"workspaces": [
        {"id": w["id"], "name": w["name"], "description": w["description"],
         "agents": len(w["agents"]), "tasks": len(w["tasks"])}
        for w in WORKSPACES.values()
    ]}


@app.get("/api/workspaces/{workspace_id}")
def get_workspace(workspace_id: str) -> dict[str, Any]:
    ws = WORKSPACES.get(workspace_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    return ws


@app.post("/api/runs")
async def start_run(req: Request) -> dict[str, Any]:
    body = await req.json() if await req.body() else {}
    workspace_id = body.get("workspace_id", "demo-research-crew")
    ws = WORKSPACES.get(workspace_id)
    if not ws:
        raise HTTPException(404, "workspace not found")
    run_id = runs.start(ws, dry_run=body.get("dry_run", True))
    return {"run_id": run_id, "workspace_id": workspace_id}


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
            terminal = rec and rec["status"] in ("succeeded", "failed")
            if terminal and not runs.events_since(run_id, last):
                yield f"event: end\ndata: {json.dumps({'status': rec['status']})}\n\n"
                break
            idle = idle + 1 if not new else 0
            if idle % 30 == 0 and idle:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---- SPA host (built React app) --------------------------------------------
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
        return JSONResponse({
            "service": "CrewForge", "ui": "not built yet",
            "hint": "build web/ then restart, or run the Vite dev server",
            "api": ["/api/health", "/api/manifest", "/api/workspaces", "/api/runs"],
        })
