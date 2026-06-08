"""Starter workflow templates — ready-to-run specs users can clone in one click."""
from __future__ import annotations

from typing import Any

TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "research-summarize",
        "name": "Research & Summarize",
        "description": "A Researcher gathers facts (with a human-approval gate), then a Writer summarizes them.",
        "spec": {
            "process": "sequential",
            "inputs": [{"name": "topic", "description": "What to research"}],
            "agents": [
                {"id": "researcher", "role": "Senior Research Analyst",
                 "goal": "Find the key facts about {topic}",
                 "backstory": "A meticulous analyst who gathers reliable information and distills it into clear, verifiable points."},
                {"id": "writer", "role": "Content Writer",
                 "goal": "Turn the research into a crisp summary",
                 "backstory": "A concise writer who turns dense notes into clear prose."},
            ],
            "tasks": [
                {"agent": "researcher", "name": "research", "description": "Research {topic}.",
                 "expected_output": "Three bullet points with sources.", "human_input": True},
                {"agent": "writer", "name": "summarize", "description": "Write a one-paragraph summary from the research.",
                 "expected_output": "One clear paragraph."},
            ],
        },
    },
    {
        "id": "content-pipeline",
        "name": "Content Pipeline",
        "description": "Research → Write → Edit. A three-agent pipeline that produces polished content.",
        "spec": {
            "process": "sequential",
            "inputs": [{"name": "topic", "description": "Article topic"}],
            "agents": [
                {"id": "researcher", "role": "Senior Research Analyst",
                 "goal": "Gather accurate, well-sourced material on {topic}",
                 "backstory": "A meticulous analyst who triangulates sources and never invents figures."},
                {"id": "writer", "role": "Content Writer",
                 "goal": "Draft an engaging article from the research",
                 "backstory": "A versatile writer who leads with the point and cuts every unnecessary word."},
                {"id": "editor", "role": "Editor-in-Chief",
                 "goal": "Polish the draft to a high editorial bar",
                 "backstory": "A sharp editor who fixes structure, clarity, and accuracy."},
            ],
            "tasks": [
                {"agent": "researcher", "name": "research", "description": "Research {topic} thoroughly.",
                 "expected_output": "A bulleted brief with sources."},
                {"agent": "writer", "name": "draft", "description": "Write a 4-paragraph article from the brief.",
                 "expected_output": "A coherent draft article."},
                {"agent": "editor", "name": "edit", "description": "Edit the draft for clarity, accuracy, and flow.",
                 "expected_output": "A polished final article.",
                 "rules": "- Fix any unsupported claim\n- Keep it under 400 words"},
            ],
        },
    },
    {
        "id": "support-triage",
        "name": "Support Triage",
        "description": "Classify an incoming ticket, then draft an accurate, empathetic response.",
        "spec": {
            "process": "sequential",
            "inputs": [{"name": "ticket", "description": "The customer message"}],
            "agents": [
                {"id": "triager", "role": "Support Triage Specialist",
                 "goal": "Classify the ticket by topic, urgency, and intent",
                 "backstory": "A fast, accurate triager who reads the whole ticket before deciding."},
                {"id": "responder", "role": "Customer Support Specialist",
                 "goal": "Draft a correct, empathetic reply",
                 "backstory": "A patient specialist who gives exact steps and never guesses at policy."},
            ],
            "tasks": [
                {"agent": "triager", "name": "classify", "description": "Classify this ticket: {ticket}",
                 "expected_output": "Category, urgency (low/med/high), and intent.",
                 "output_schema": [{"name": "category", "type": "string"}, {"name": "urgency", "type": "string"}]},
                {"agent": "responder", "name": "respond", "description": "Draft a reply to the customer.",
                 "expected_output": "A friendly, accurate response with clear next steps.", "human_input": True},
            ],
        },
    },
]


def get_template(template_id: str) -> dict[str, Any] | None:
    return next((t for t in TEMPLATES if t["id"] == template_id), None)
