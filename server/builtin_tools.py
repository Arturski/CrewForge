"""Built-in crewai_tools: config (args + env keys) and live instantiation.

The catalog (compiler/tools.py) lists every installed crewai_tools class; this
module makes them runnable: per-tool config stored in settings (env values
encrypted like LLM keys / MCP env), and `instantiate()` builds live tool
objects for the runner. Tools whose required keys are missing simply don't
attach — the run continues and the gap is surfaced as a run event.
"""
from __future__ import annotations

import os
import types
import typing
from typing import Any

from . import secrets, store

_SETTING = "tool_configs"

# Param types we can render as a simple form field; everything else is left
# to the tool's defaults (complex params are out of no-code scope).
_SIMPLE = {str: "string", int: "integer", float: "number", bool: "boolean"}


def _base_fields() -> set[str]:
    from crewai.tools.base_tool import BaseTool
    return set(BaseTool.model_fields)


def _simple_type(annotation: Any) -> str | None:
    """Map a field annotation to a form type, unwrapping Optional[...]."""
    if annotation in _SIMPLE:
        return _SIMPLE[annotation]
    origin = typing.get_origin(annotation)
    if origin in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        if len(args) == 1 and args[0] in _SIMPLE:
            return _SIMPLE[args[0]]
    return None


def _tool_class(name: str):
    import crewai_tools
    cls = getattr(crewai_tools, name, None)
    return cls if isinstance(cls, type) else None


def describe(name: str) -> dict[str, Any] | None:
    """Config surface for one tool: simple params + env vars it needs."""
    cls = _tool_class(name)
    if cls is None or not hasattr(cls, "model_fields"):
        return None
    base = _base_fields()
    params = []
    for fname, field in cls.model_fields.items():
        if fname in base:
            continue
        ftype = _simple_type(field.annotation)
        if ftype is None:
            continue
        default = None if field.is_required() else field.default
        if default is not None and type(default).__name__ == "PydanticUndefinedType":
            default = None  # default_factory-backed fields have no plain default
        params.append({"name": fname, "type": ftype, "default": default,
                       "required": field.is_required()})
    env_field = cls.model_fields.get("env_vars")
    env_vars = []
    try:
        default = (env_field.default_factory() if env_field and env_field.default_factory
                   else (env_field.default if env_field else None)) or []
        env_vars = [{"name": e.name, "required": bool(e.required)} for e in default]
    except Exception:  # noqa: BLE001 — metadata is best-effort, never block the catalog
        pass
    return {"params": params, "env_vars": env_vars}


# -- config store --------------------------------------------------------------
def _configs() -> dict[str, Any]:
    return store.get_setting(_SETTING) or {}


def get_config(name: str, masked: bool = True) -> dict[str, Any]:
    cfg = _configs().get(name) or {}
    args = dict(cfg.get("args") or {})
    env = cfg.get("env") or {}
    if masked:
        return {"args": args, "env": {k: "•••" for k in env}}
    return {"args": args, "env": {k: secrets.dec(v) for k, v in env.items()}}


def set_config(name: str, args: dict[str, Any] | None, env: dict[str, str] | None) -> None:
    cfgs = _configs()
    prev_env = (cfgs.get(name) or {}).get("env") or {}
    new_env: dict[str, str] = {}
    for k, v in (env or {}).items():
        if not k:
            continue
        if v == "•••" and k in prev_env:  # masked placeholder = keep existing secret
            new_env[k] = prev_env[k]
        elif v:
            new_env[k] = secrets.enc(v)
    entry = {"args": {k: v for k, v in (args or {}).items() if v not in ("", None)},
             "env": new_env}
    if entry["args"] or entry["env"]:
        cfgs[name] = entry
    else:
        cfgs.pop(name, None)
    store.set_setting(_SETTING, cfgs)


def delete_config(name: str) -> None:
    cfgs = _configs()
    if cfgs.pop(name, None) is not None:
        store.set_setting(_SETTING, cfgs)


def status(name: str) -> dict[str, Any]:
    """Readiness for the catalog card: configured? missing required keys?"""
    desc = describe(name) or {"params": [], "env_vars": []}
    cfg = _configs().get(name) or {}
    have_env = set(cfg.get("env") or {})
    missing = [e["name"] for e in desc["env_vars"]
               if e["required"] and e["name"] not in have_env and not os.environ.get(e["name"])]
    return {"configured": bool(cfg), "missing_env": missing}


# -- live instantiation ---------------------------------------------------------
def instantiate(names: list[str]) -> tuple[dict[str, Any], dict[str, str]]:
    """Build live tool objects for the given catalog names.

    Returns (tools_by_name, errors_by_name). Decrypted env values are exported
    to os.environ before construction (process-wide; fine for the single-user
    server — same approach as MCP stdio servers).
    """
    tools: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for name in names:
        cls = _tool_class(name)
        if cls is None:
            continue
        cfg = get_config(name, masked=False)
        st = status(name)
        if st["missing_env"]:
            errors[name] = f"missing key: {', '.join(st['missing_env'])}"
            continue
        try:
            for k, v in cfg["env"].items():
                if v:
                    os.environ[k] = v
            tools[name] = cls(**cfg["args"])
        except Exception as e:  # noqa: BLE001 — a bad tool must not kill the run
            errors[name] = f"{type(e).__name__}: {e}"[:200]
    return tools, errors
