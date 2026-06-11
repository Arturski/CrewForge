"""Adapter — declarative spec -> live CrewAI objects.

Also provides FakeLLM: a zero-cost, no-network mock model used for CrewForge's
"dry-run" mode, so the product is fully try-able with no API key.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from crewai import Agent, Crew, Process, Task
from crewai.llms.base_llm import BaseLLM
from crewai.tasks.conditional_task import ConditionalTask
from pydantic import create_model

# JSON-schema-ish field type -> python type for structured task outputs.
_OUTPUT_TYPES = {"string": str, "number": float, "integer": int, "boolean": bool, "list": list}

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


# No-code run conditions: the task runs only if the PREVIOUS task's output
# passes the check. Evaluated by crewai's ConditionalTask (skip = empty output).
CONDITION_CHECKS = {"contains", "not_contains", "regex"}


def make_condition(cond: dict[str, Any],
                   task_index: int = -1,
                   observer: Callable[[int, bool], None] | None = None):
    """Compile a spec condition into a ConditionalTask predicate.

    `observer(task_index, will_run)` fires on every evaluation so the runner
    can emit a task.skipped event and keep its task-index correlation in sync
    (crewai fires no task event at all for a skipped conditional task).
    """
    check = cond.get("check")
    value = str(cond.get("value") or "")
    case_sensitive = bool(cond.get("case_sensitive"))

    def predicate(output: Any) -> bool:
        text = str(getattr(output, "raw", output) or "")
        if check == "regex":
            ok = re.search(value, text, 0 if case_sensitive else re.IGNORECASE) is not None
        else:
            t, v = (text, value) if case_sensitive else (text.lower(), value.lower())
            ok = (v in t) if check == "contains" else (v not in t)
        if observer is not None:
            observer(task_index, ok)
        return ok

    return predicate


def _output_model(task_name: str, schema: list[dict[str, Any]]):
    """Build a Pydantic model from a simple [{name, type}] schema for structured output."""
    fields = {
        f["name"]: (_OUTPUT_TYPES.get(f.get("type", "string"), str), ...)
        for f in schema if f.get("name")
    }
    if not fields:
        return None
    safe = "".join(c for c in (task_name or "Output").title() if c.isalnum()) or "Output"
    return create_model(f"{safe}Output", **fields)  # type: ignore[call-overload]


def build_crew(spec: dict[str, Any], llm: BaseLLM | None = None, hitl_gate=None,
               agent_tools: dict[str, list] | None = None,
               agent_llms: dict[str, Any] | None = None,
               condition_observer: Callable[[int, bool], None] | None = None) -> Crew:
    """Build a CrewAI Crew from a CrewForge spec.

    - Curated + advanced scalar agent fields are passed through (AGENT_SCALAR_FIELDS).
    - Per-agent LLM override via `agent_llms[agent_id]` (else the crew `llm`).
    - Per-task "rules" compiled into the description as hard constraints.
    - Structured output (task.output_schema) -> output_pydantic, live runs only.
    - Crew `memory` enabled on live runs only (needs an embedder).
    - HITL is a worker-owned guardrail gate; `planning`/hierarchical honored.
    """
    llm = llm or FakeLLM()
    live = not isinstance(llm, FakeLLM)  # gates features that need a real model/embedder
    agent_llms = agent_llms or {}

    agents: dict[str, Agent] = {}
    for a in spec.get("agents", []):
        kwargs: dict[str, Any] = {
            "role": a["role"], "goal": a["goal"], "backstory": a["backstory"],
            "llm": agent_llms.get(a["id"], llm), "verbose": False,
        }
        for f in AGENT_SCALAR_FIELDS:
            if f in a and _coerce(a[f]) is not None:
                kwargs[f] = a[f]
        if agent_tools and agent_tools.get(a["id"]):
            kwargs["tools"] = agent_tools[a["id"]]
        agents[a["id"]] = Agent(**kwargs)

    tasks: list[Task] = []
    for i, t in enumerate(spec.get("tasks", [])):
        description = t["description"]
        rules = (t.get("rules") or "").strip()
        if rules:
            description = (
                f"{description}\n\nSTRICT RULES — you MUST follow every rule and "
                f"reason step-by-step before answering:\n{rules}"
            )
        tkwargs: dict[str, Any] = {
            "description": description,
            "expected_output": t["expected_output"],
            "agent": agents[t["agent"]],
        }
        if t.get("human_input") and hitl_gate:
            tkwargs["guardrail"] = hitl_gate
        if t.get("async_execution"):
            tkwargs["async_execution"] = True
        # Explicit data-flow dependencies: indices of EARLIER tasks whose output
        # feeds this one (later/self refs are dropped — output wouldn't exist yet).
        ctx = [tasks[c] for c in (t.get("context") or [])
               if isinstance(c, int) and 0 <= c < len(tasks)]
        if ctx:
            tkwargs["context"] = ctx
        if live and t.get("output_schema"):
            model = _output_model(t.get("name", ""), t["output_schema"])
            if model is not None:
                tkwargs["output_pydantic"] = model
        cond = t.get("condition") or {}
        if cond.get("check") in CONDITION_CHECKS:
            name = t.get("name") or f"task {i + 1}"
            if i == 0:
                raise ValueError(
                    "The first task cannot have a run condition — there is no previous output to test.")
            if t.get("async_execution"):
                raise ValueError(
                    f"Task '{name}' cannot be both conditional and async (crewai limitation).")
            tkwargs["condition"] = make_condition(cond, i, condition_observer)
            tasks.append(ConditionalTask(**tkwargs))
        else:
            tasks.append(Task(**tkwargs))

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
    }
    if spec.get("planning") and live:
        # CrewAI's planner needs a real model (structured output) + defaults to
        # OpenAI unless we pass the configured LLM. Skipped in dry-run.
        crew_kwargs["planning"] = True
        crew_kwargs["planning_llm"] = llm
    if live and spec.get("memory"):
        crew_kwargs["memory"] = True
    if process == Process.hierarchical:
        # A designated agent can manage the crew; crewai requires the manager
        # to be neither in the agents list nor assigned to a task, so we only
        # honor the pick when it's task-free (else fall back to an LLM manager).
        mgr_id = spec.get("manager_agent_id")
        assigned = {t.get("agent") for t in spec.get("tasks", [])}
        if mgr_id and mgr_id in agents and mgr_id not in assigned:
            crew_kwargs["manager_agent"] = agents[mgr_id]
            crew_kwargs["agents"] = [ag for aid, ag in agents.items() if aid != mgr_id]
        else:
            crew_kwargs["manager_llm"] = llm
    return Crew(**crew_kwargs)
