"""Adapter — declarative spec -> live CrewAI objects.

Also provides FakeLLM: a zero-cost, no-network mock model used for CrewForge's
"dry-run" mode, so the product is fully try-able with no API key.
"""
from __future__ import annotations

from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM

# Scalar Agent fields safe to pass straight through from the spec to the Agent
# constructor (the curated UI + manifest "advanced" panel write these).
AGENT_SCALAR_FIELDS = {
    "verbose", "max_iter", "max_rpm", "max_retry_limit", "allow_delegation",
    "cache", "reasoning", "multimodal", "respect_context_window",
    "max_execution_time", "inject_date", "date_format", "use_system_prompt",
    "max_reasoning_attempts",
}


class FakeLLM(BaseLLM):
    """Deterministic mock LLM. Returns a ReAct 'Final Answer' so agents complete
    with no network/keys. Powers dry-run mode."""

    def __init__(self, **data: Any):
        data.setdefault("model", "crewforge/dry-run")
        super().__init__(**data)
        object.__setattr__(self, "_n", 0)

    def call(self, messages, tools=None, callbacks=None, available_functions=None,
             from_task=None, from_agent=None, response_model=None, **kwargs) -> str:
        self._n += 1
        role = getattr(from_agent, "role", "agent")
        return (
            "Thought: I now can give a great answer\n"
            f"Final Answer: [{role}] dry-run output #{self._n} — "
            "(CrewForge mock LLM; configure a provider in Models to run live)."
        )

    def supports_function_calling(self) -> bool:
        return False

    def supports_stop_words(self) -> bool:
        return False

    def get_context_window_size(self) -> int:
        return 8192


def _coerce(value: Any) -> Any:
    if value in ("", None):
        return None
    return value


def build_crew(spec: dict[str, Any], llm: BaseLLM | None = None, hitl_gate=None,
               agent_tools: dict[str, list] | None = None) -> Crew:
    """Build a CrewAI Crew from a CrewForge spec.

    - Curated + advanced scalar agent fields are passed through (AGENT_SCALAR_FIELDS).
    - Per-task "rules" are compiled into the task description as hard constraints
      (reliable, model-agnostic way to enforce strict reasoning/quality).
    - HITL is a worker-owned guardrail gate (not crewai's native human_input).
    - `planning` and hierarchical `process` are honored at the crew level.
    """
    llm = llm or FakeLLM()
    agents: dict[str, Agent] = {}
    for a in spec.get("agents", []):
        kwargs: dict[str, Any] = {
            "role": a["role"], "goal": a["goal"], "backstory": a["backstory"],
            "llm": llm, "verbose": False,
        }
        for f in AGENT_SCALAR_FIELDS:
            if f in a and _coerce(a[f]) is not None:
                kwargs[f] = a[f]
        if agent_tools and agent_tools.get(a["id"]):
            kwargs["tools"] = agent_tools[a["id"]]
        agents[a["id"]] = Agent(**kwargs)

    tasks: list[Task] = []
    for t in spec.get("tasks", []):
        description = t["description"]
        rules = (t.get("rules") or "").strip()
        if rules:
            description = (
                f"{description}\n\nSTRICT RULES — you MUST follow every rule and "
                f"reason step-by-step before answering:\n{rules}"
            )
        guardrail = hitl_gate if (t.get("human_input") and hitl_gate) else None
        tasks.append(
            Task(
                description=description,
                expected_output=t["expected_output"],
                agent=agents[t["agent"]],
                guardrail=guardrail,
            )
        )

    process = (
        Process.hierarchical
        if spec.get("process") == "hierarchical"
        else Process.sequential
    )
    crew_kwargs: dict[str, Any] = {
        "agents": list(agents.values()),
        "tasks": tasks,
        "process": process,
        "verbose": False,
        "planning": bool(spec.get("planning")),
    }
    if process == Process.hierarchical:
        crew_kwargs["manager_llm"] = llm
    return Crew(**crew_kwargs)
