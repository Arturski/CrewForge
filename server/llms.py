"""Multiple named LLM connections + per-workflow / per-agent selection.

Stored in settings as a list `llms` + a `default_llm` id. Keys are encrypted at
rest (secrets). Legacy single `llm` setting is migrated into the list on read.
"""
from __future__ import annotations

import uuid
from typing import Any

from . import secrets, store


def _state() -> tuple[list[dict[str, Any]], str | None]:
    llms = store.get_setting("llms")
    default = store.get_setting("default_llm")
    if not llms:
        legacy = store.get_setting("llm")
        if legacy and legacy.get("model"):
            cid = "llm-default"
            llms = [{"id": cid, "name": legacy.get("model", "Default"), "model": legacy["model"],
                     "base_url": legacy.get("base_url", ""), "temperature": legacy.get("temperature"),
                     "api_key": legacy.get("api_key")}]
            default = cid
            store.set_setting("llms", llms)
            store.set_setting("default_llm", default)
        else:
            llms = []
    ids = {x["id"] for x in llms}
    if default not in ids:
        default = llms[0]["id"] if llms else None
    return llms, default


def list_public() -> dict[str, Any]:
    llms, default = _state()
    return {
        "llms": [{"id": x["id"], "name": x["name"], "model": x["model"], "base_url": x.get("base_url", ""),
                  "temperature": x.get("temperature"), "api_key_set": bool(x.get("api_key"))} for x in llms],
        "default": default,
    }


def upsert(cfg: dict[str, Any]) -> dict[str, Any]:
    llms, default = _state()
    cid = cfg.get("id") or f"llm-{uuid.uuid4().hex[:8]}"
    entry = next((x for x in llms if x["id"] == cid), None)
    new = entry is None
    entry = entry or {"id": cid}
    entry["name"] = cfg.get("name") or cfg.get("model", "LLM")
    entry["model"] = cfg.get("model", "")
    entry["base_url"] = cfg.get("base_url", "")
    entry["temperature"] = cfg.get("temperature")
    if cfg.get("api_key"):
        entry["api_key"] = secrets.enc(cfg["api_key"])
    if new:
        llms.append(entry)
        default = default or cid
    store.set_setting("llms", llms)
    store.set_setting("default_llm", default)
    return {"id": entry["id"], "name": entry["name"]}


def delete(cid: str) -> None:
    llms, default = _state()
    llms = [x for x in llms if x["id"] != cid]
    if default == cid:
        default = llms[0]["id"] if llms else None
    store.set_setting("llms", llms)
    store.set_setting("default_llm", default)


def set_default(cid: str) -> None:
    llms, _ = _state()
    if any(x["id"] == cid for x in llms):
        store.set_setting("default_llm", cid)


def resolve(llm_id: str | None = None) -> dict[str, Any] | None:
    """Decrypted config for llm_id, else the default. None if nothing configured."""
    llms, default = _state()
    by_id = {x["id"]: x for x in llms}
    cfg = by_id.get(llm_id or "") or by_id.get(default or "")
    if not cfg:
        return None
    return {**cfg, "api_key": secrets.dec(cfg.get("api_key"))}


def build(llm_id: str | None = None):
    """Build a crewai LLM from a config id (or default). None if not configured."""
    cfg = resolve(llm_id)
    if not cfg or not cfg.get("model"):
        return None
    from crewai import LLM
    kw: dict[str, Any] = {"model": cfg["model"]}
    if cfg.get("api_key"):
        kw["api_key"] = cfg["api_key"]
    if cfg.get("base_url"):
        kw["base_url"] = cfg["base_url"]
    if cfg.get("temperature") is not None:
        kw["temperature"] = cfg["temperature"]
    return LLM(**kw)
