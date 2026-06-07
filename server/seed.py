"""Seed workspace(s) so the app is usable immediately on first launch."""
from __future__ import annotations

from typing import Any

DEMO_WORKSPACE: dict[str, Any] = {
    "id": "demo-research-crew",
    "name": "Research & Summarize",
    "description": "A 2-agent sequential crew: a Researcher gathers facts (with a "
                   "human-approval gate), then a Writer summarizes them.",
    "process": "sequential",
    "agents": [
        {
            "id": "researcher",
            "role": "Researcher",
            "goal": "Find the key facts about the given topic",
            "backstory": "A meticulous analyst who gathers reliable information and "
                         "distills it into clear, verifiable points.",
        },
        {
            "id": "writer",
            "role": "Writer",
            "goal": "Turn research notes into a crisp summary",
            "backstory": "A concise writer who turns dense notes into clear prose.",
        },
    ],
    "tasks": [
        {
            "agent": "researcher",
            "description": "Research the benefits of no-code agent tooling.",
            "expected_output": "Three bullet points.",
            "human_input": True,
        },
        {
            "agent": "writer",
            "description": "Write a one-paragraph summary from the research.",
            "expected_output": "One paragraph.",
        },
    ],
}

WORKSPACES: dict[str, dict[str, Any]] = {DEMO_WORKSPACE["id"]: DEMO_WORKSPACE}
