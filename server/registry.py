"""Skill marketplace — search the official MCP Registry and turn entries into
connectable server configs.

Source: https://registry.modelcontextprotocol.io (public, no auth). Each registry
entry exposes `remotes` (hosted URL) and/or `packages` (npm/pypi) which we map to
a ready-to-connect config the user can install with one click. Installing reuses
server.mcp.add_server (connect + discover tools).
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

_BASE = "https://registry.modelcontextprotocol.io/v0/servers"


def _fetch(params: dict[str, Any]) -> dict[str, Any]:
    url = _BASE + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "CrewForge"})
    with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 (fixed host)
        return json.load(r)


def _install_from_package(pkg: dict[str, Any]) -> dict[str, Any] | None:
    rt = pkg.get("registryType")
    ident = pkg.get("identifier", "")
    ver = pkg.get("version")
    runtime = pkg.get("runtimeHint")
    args: list[str] = []
    for ra in pkg.get("runtimeArguments", []) or []:
        if ra.get("value"):
            args.append(ra["value"])
    if rt == "npm":
        command = runtime or "npx"
        if "-y" not in args:
            args = ["-y", *args]
        args.append(f"{ident}@{ver}" if ver else ident)
    elif rt == "pypi":
        command = runtime or "uvx"
        args.append(ident)
    else:
        return None
    for pa in pkg.get("packageArguments", []) or []:
        if pa.get("value"):
            args.append(pa["value"])
    env_required = [ev["name"] for ev in (pkg.get("environmentVariables") or []) if ev.get("isRequired")]
    return {"transport": "stdio", "command": command, "args": args,
            "env_required": env_required, "source": rt}


def _install_from_remote(rem: dict[str, Any]) -> dict[str, Any]:
    return {"transport": rem.get("type", "streamable-http"), "url": rem.get("url"),
            "env_required": [], "source": "remote"}


def _card(item: dict[str, Any]) -> dict[str, Any] | None:
    s = item.get("server", {})
    meta = item.get("_meta", {}).get("io.modelcontextprotocol.registry/official", {})
    install: dict[str, Any] | None = None
    if s.get("remotes"):
        install = _install_from_remote(s["remotes"][0])
    elif s.get("packages"):
        for p in s["packages"]:
            install = _install_from_package(p)
            if install:
                break
    if not install:
        return None
    from . import security
    return {
        "name": s.get("name", ""),
        "title": s.get("title") or s.get("name", ""),
        "description": (s.get("description") or "")[:200],
        "version": s.get("version"),
        "status": meta.get("status", "active"),
        "risk": "high" if install["transport"] == "stdio" else "medium",
        "security": security.assess({**install, "registry_listed": True}),
        "install": install,
    }


def search(query: str = "", limit: int = 30) -> dict[str, Any]:
    params: dict[str, Any] = {"limit": min(max(limit, 1), 50)}
    if query:
        params["search"] = query
    try:
        data = _fetch(params)
    except Exception as e:  # noqa: BLE001
        return {"servers": [], "error": f"{type(e).__name__}: {e}"[:200]}
    # dedupe by name, keeping the latest entry seen
    seen: dict[str, dict[str, Any]] = {}
    for it in data.get("servers", []):
        c = _card(it)
        if c and c["name"]:
            seen[c["name"]] = c
    return {"servers": list(seen.values())}
