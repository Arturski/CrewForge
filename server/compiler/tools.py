"""Tool catalog — introspect available CrewAI tools (best-effort).

crewai_tools is optional; if absent we return an empty catalog. Each entry carries
enough to render a card and attach the tool to an agent by name.
"""
from __future__ import annotations

import functools
from typing import Any


@functools.lru_cache(maxsize=1)
def tool_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        import crewai_tools  # type: ignore
    except Exception:  # noqa: BLE001
        return out

    for name in dir(crewai_tools):
        if not name.endswith("Tool"):
            continue
        obj = getattr(crewai_tools, name, None)
        if not isinstance(obj, type):
            continue
        doc = (obj.__doc__ or "").strip().split("\n")[0][:160]
        out.append({"name": name, "description": doc or "CrewAI tool", "kind": "builtin"})
    out.sort(key=lambda t: t["name"])
    return out
