"""Honest security assessment for MCP integrations.

Rather than a fabricated trust score, we surface the real risk factors a user
should weigh before connecting a server: does it execute code locally, is the
connection encrypted, does it need credentials, is it listed in the official
registry. (A real mcp-scan integration can augment this later via `findings`.)
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse


def assess(cfg: dict[str, Any]) -> dict[str, Any]:
    transport = cfg.get("transport", "stdio")
    factors: list[str] = []
    if cfg.get("registry_listed"):
        factors.append("Listed in the official MCP registry")

    if transport == "stdio":
        level = "high"
        label = "Runs code locally"
        cmd = (cfg.get("command", "") + " " + " ".join(cfg.get("args", []) or [])).strip()
        factors.append("Executes a command on this machine with your privileges")
        if cmd:
            factors.append(f"Command: {cmd}")
        if cfg.get("env") or cfg.get("env_required"):
            factors.append("Requires credentials / environment variables")
    else:
        url = cfg.get("url", "") or ""
        host = urlparse(url).hostname or "a remote server"
        if url.startswith("https://"):
            level = "medium"
            label = "Remote (HTTPS)"
            factors.append(f"Runs on a third party — your prompts/data go to {host}")
        else:
            level = "high"
            label = "Remote (unencrypted)"
            factors.append("Connection is not encrypted (http) — avoid for anything sensitive")

    return {"level": level, "label": label, "factors": factors, "scanner": "heuristic"}
