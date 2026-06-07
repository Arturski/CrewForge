"""Adapter — declarative spec -> live CrewAI objects (promoted from spike B).

Also provides FakeLLM: a zero-cost, no-network mock model used for CrewForge's
"dry-run" mode, so the product is fully try-able with no API key.
"""
from __future__ import annotations

from typing import Any

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM


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
            "(CrewForge mock LLM; set a real provider to run live)."
        )

    def supports_function_calling(self) -> bool:
        return False

    def supports_stop_words(self) -> bool:
        return False

    def get_context_window_size(self) -> int:
        return 8192


def build_crew(spec: dict[str, Any], llm: BaseLLM | None = None, hitl_gate=None) -> Crew:
    """Build a CrewAI Crew from a CrewForge spec.

    HITL is modeled as a task `guardrail` (the worker-owned gate), NOT crewai's
    native human_input (broken in 1.14.6). `hitl_gate(output) -> (approved, value)`.
    """
    llm = llm or FakeLLM()
    agents: dict[str, Agent] = {}
    for a in spec["agents"]:
        agents[a["id"]] = Agent(
            role=a["role"],
            goal=a["goal"],
            backstory=a["backstory"],
            llm=llm,
            verbose=False,
            allow_delegation=a.get("allow_delegation", False),
        )

    tasks: list[Task] = []
    for t in spec["tasks"]:
        guardrail = hitl_gate if (t.get("human_input") and hitl_gate) else None
        tasks.append(
            Task(
                description=t["description"],
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
    return Crew(agents=list(agents.values()), tasks=tasks, process=process, verbose=False)
