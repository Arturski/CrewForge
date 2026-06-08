"""MCP (Model Context Protocol) server connections — external & local skills.

Lets users connect MCP servers (local stdio commands or remote SSE/HTTP URLs),
discover their tools, and attach those tools to agents. MCP is how skills are
shared/transferred across agents in the 2026 ecosystem.

Server configs are stored in the settings store. Discovery connects on demand
via crewai-tools' MCPServerAdapter and lists tool metadata.

SECURITY: stdio servers execute a command on this machine; remote servers can
return adversarial tool descriptions. Treat every server as code you run. The UI
surfaces this and tags stdio as elevated risk.
"""
from __future__ import annotations

import os
import uuid
from typing import Any

from . import store

_KEY = "mcp_servers"


def list_servers() -> list[dict[str, Any]]:
    return store.get_setting(_KEY, []) or []


def _save(servers: list[dict[str, Any]]) -> None:
    store.set_setting(_KEY, servers)


def _server_params(cfg: dict[str, Any]):
    """Build serverparams for MCPServerAdapter from a stored config."""
    transport = cfg.get("transport", "stdio")
    if transport == "stdio":
        from mcp import StdioServerParameters
        return StdioServerParameters(
            command=cfg["command"],
            args=cfg.get("args", []),
            env={**os.environ, **(cfg.get("env") or {})},
        )
    # remote: sse | streamable-http
    return {"url": cfg["url"], "transport": transport}


def discover(cfg: dict[str, Any]) -> dict[str, Any]:
    """Connect briefly and list the server's tools. Never raises."""
    try:
        from crewai_tools import MCPServerAdapter
        with MCPServerAdapter(_server_params(cfg), connect_timeout=25) as tools:
            return {
                "ok": True,
                "tools": [
                    {"name": t.name, "description": (getattr(t, "description", "") or "")[:160]}
                    for t in tools
                ],
            }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300], "tools": []}


def add_server(cfg: dict[str, Any]) -> dict[str, Any]:
    """Validate by connecting, then persist with cached tools + status."""
    transport = cfg.get("transport", "stdio")
    entry: dict[str, Any] = {
        "id": f"mcp-{uuid.uuid4().hex[:8]}",
        "name": cfg.get("name") or "mcp-server",
        "transport": transport,
        "risk": "high" if transport == "stdio" else "medium",
    }
    if transport == "stdio":
        entry["command"] = cfg.get("command", "")
        entry["args"] = cfg.get("args", [])
        entry["env"] = cfg.get("env", {})
    else:
        entry["url"] = cfg.get("url", "")

    result = discover(entry)
    entry["status"] = "connected" if result["ok"] else "error"
    entry["tools"] = result["tools"]
    entry["error"] = result.get("error")

    servers = list_servers()
    servers.append(entry)
    _save(servers)
    return entry


def remove_server(server_id: str) -> None:
    _save([s for s in list_servers() if s["id"] != server_id])


def rescan(server_id: str) -> dict[str, Any] | None:
    servers = list_servers()
    for s in servers:
        if s["id"] == server_id:
            r = discover(s)
            s["status"] = "connected" if r["ok"] else "error"
            s["tools"] = r["tools"]
            s["error"] = r.get("error")
            _save(servers)
            return s
    return None


def mcp_tool_catalog() -> list[dict[str, Any]]:
    """All MCP tools across connected servers, for the skills catalog."""
    out: list[dict[str, Any]] = []
    for s in list_servers():
        for t in s.get("tools", []):
            out.append({
                "name": t["name"], "description": t["description"],
                "kind": "mcp", "server": s["name"], "server_id": s["id"],
                "risk": s.get("risk", "medium"),
            })
    return out


def open_tools_for(tool_names: set[str]) -> tuple[list[Any], list[Any]]:
    """For a live run: open adapters for servers that provide any of `tool_names`
    and return (selected_tools, adapters_to_stop). Caller must stop adapters.
    Best-effort: a failing server is skipped.
    """
    from crewai_tools import MCPServerAdapter
    selected: list[Any] = []
    adapters: list[Any] = []
    for s in list_servers():
        provided = {t["name"] for t in s.get("tools", [])}
        if not (provided & tool_names):
            continue
        try:
            adapter = MCPServerAdapter(_server_params(s), connect_timeout=25)
            adapters.append(adapter)
            for t in adapter.tools:
                if t.name in tool_names:
                    selected.append(t)
        except Exception:  # noqa: BLE001
            continue
    return selected, adapters
