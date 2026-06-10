"""LLM entity/relation extraction for the knowledge graph.

Uses a configured LLM connection (crewai LLM, `.call(prompt) -> str`). The
graph layer is optional: with no provider set, KBs stay vector-only.
"""
from __future__ import annotations

import json
import re
from typing import Any

_PROMPT = """Extract the key entities and relationships from the text below.

Return ONLY a JSON object, no prose, in exactly this shape:
{{"entities": [{{"name": "...", "type": "person|org|place|product|concept|event|other"}}],
 "relations": [{{"source": "...", "label": "short verb phrase", "target": "..."}}]}}

Rules: at most 12 entities and 12 relations; entity names short and canonical
(e.g. "Acme Corp", not "the company Acme Corp"); relation source/target must be
entity names from your list.

TEXT:
{text}
"""

MAX_ITEMS = 12


def parse(raw: str) -> dict[str, list[dict[str, Any]]]:
    """Tolerant JSON parse of a model reply (code fences, surrounding prose)."""
    text = re.sub(r"^```[a-z]*\s*|\s*```$", "", (raw or "").strip(), flags=re.MULTILINE)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return {"entities": [], "relations": []}
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {"entities": [], "relations": []}
    entities = [
        {"name": str(e.get("name", "")).strip(), "type": str(e.get("type", "")).strip()}
        for e in data.get("entities", []) if isinstance(e, dict) and str(e.get("name", "")).strip()
    ][:MAX_ITEMS]
    relations = [
        {"source": str(r.get("source", "")).strip(), "label": str(r.get("label", "")).strip(),
         "target": str(r.get("target", "")).strip()}
        for r in data.get("relations", [])
        if isinstance(r, dict) and str(r.get("source", "")).strip() and str(r.get("target", "")).strip()
    ][:MAX_ITEMS]
    return {"entities": entities, "relations": relations}


def extract(llm: Any, text: str) -> dict[str, list[dict[str, Any]]]:
    """One extraction call. Raises on transport/auth errors (caller decides)."""
    reply = llm.call(_PROMPT.format(text=text[:6000]))
    return parse(reply if isinstance(reply, str) else str(reply))
