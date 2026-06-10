"""A CrewAI tool that lets an agent search a CrewForge knowledge base."""
from __future__ import annotations

import re
from typing import Any

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from .. import knowledge


class _Args(BaseModel):
    query: str = Field(description="What to look up in the knowledge base")


def make_tool(kb: dict[str, Any]) -> BaseTool:
    kb_id = kb["id"]
    kb_name = kb.get("name", "knowledge")
    slug = re.sub(r"[^a-z0-9_]+", "_", kb_name.lower()).strip("_") or "kb"

    class KnowledgeSearchTool(BaseTool):
        name: str = f"search_{slug}"
        description: str = (
            f"Search the '{kb_name}' knowledge base for relevant information. "
            "Use this whenever you need facts from the user's documents."
        )
        args_schema: type[BaseModel] = _Args

        def _run(self, query: str) -> str:
            hits = knowledge.search(kb_id, query, k=5)
            if not hits:
                return "No relevant information found in the knowledge base."
            out = "\n\n".join(f"[source: {h['source']}]\n{h['text']}" for h in hits)
            # Hybrid retrieval: pull entity facts connected to the hit chunks
            # from the KB's graph (present only after a graph build).
            facts = knowledge.related_facts(kb_id, [h["chunk_id"] for h in hits])
            if facts:
                out += "\n\nRelated facts from the knowledge graph:\n" + "\n".join(
                    f"- {f['source']} — {f['label']} — {f['target']}" for f in facts)
            return out

    return KnowledgeSearchTool()
