"""Spike B — Run-loop plumbing proof (no Docker, no API keys, no cost).

Proves the chain the real product depends on:
  declarative spec  -> adapter.build_crew()  -> kickoff()
                    -> ForgeEventListener (subclass of crewai BaseEventListener)
                       captures every crewai event and "emits" it (would HTTP POST
                       to the control plane; here we append + print a live timeline)
                    -> HITL: a human_input task's prompt is INTERCEPTED and answered
                       programmatically from outside the agent (in prod: long-poll
                       to the control plane instead of stdin).

The container is just an isolation wrapper; this plumbing is identical whether the
worker runs in a container or, as here, in-process. So running locally fully
validates the integration. Throwaway spike; promoted to worker/ + server/compiler
in P0/P1 if it passes.

Run:  uv run python spikes/spike_b_runloop/run.py
"""
from __future__ import annotations

import builtins
import datetime as dt
import os
from typing import Any

os.environ.setdefault("OPENAI_API_KEY", "sk-fake-not-used")  # never hit; custom LLM

from crewai import Agent, Crew, Process, Task
from crewai.events import BaseEventListener, crewai_event_bus
from crewai.events.types.agent_events import (
    AgentExecutionCompletedEvent,
    AgentExecutionStartedEvent,
)
from crewai.events.types.crew_events import (
    CrewKickoffCompletedEvent,
    CrewKickoffStartedEvent,
)
from crewai.events.types.llm_events import LLMCallStartedEvent
from crewai.events.types.task_events import TaskCompletedEvent, TaskStartedEvent
from crewai.llms.base_llm import BaseLLM

# ---------------------------------------------------------------------------
# 1) Fake LLM — returns a canned ReAct "Final Answer" so agents complete with
#    zero network/cost. Stands in for any real provider during the spike.
# ---------------------------------------------------------------------------
class FakeLLM(BaseLLM):
    def __init__(self, **data: Any):
        data.setdefault("model", "fake/echo")
        super().__init__(**data)
        object.__setattr__(self, "_n", 0)

    def call(self, messages, tools=None, callbacks=None, available_functions=None,
             from_task=None, from_agent=None, response_model=None, **kwargs) -> str:
        self._n += 1
        role = getattr(from_agent, "role", "agent")
        return (
            "Thought: I now can give a great answer\n"
            f"Final Answer: [{role}] synthesized output #{self._n} "
            "(produced by FakeLLM in the CrewForge run-loop spike)."
        )

    def supports_function_calling(self) -> bool:
        return False

    def supports_stop_words(self) -> bool:
        return False

    def get_context_window_size(self) -> int:
        return 8192


# ---------------------------------------------------------------------------
# 2) Adapter — the spec -> CrewAI translation layer (the real product's core).
#    Generic enough to show the principle; the production adapter consumes the
#    full manifest from Spike A.
# ---------------------------------------------------------------------------
def build_crew(spec: dict[str, Any], llm: BaseLLM, hitl_gate=None) -> Crew:
    agents: dict[str, Agent] = {}
    for a in spec["agents"]:
        agents[a["id"]] = Agent(
            role=a["role"], goal=a["goal"], backstory=a["backstory"],
            llm=llm, verbose=False, allow_delegation=False,
        )
    tasks = []
    for t in spec["tasks"]:
        # HITL is modeled as a guardrail the worker controls — NOT crewai's native
        # human_input (which is buggy in 1.14.6 and bypasses stdin). The guardrail
        # is the exact point where the worker long-polls the UI for a decision.
        guardrail = hitl_gate if t.get("human_input") and hitl_gate else None
        tasks.append(
            Task(
                description=t["description"],
                expected_output=t["expected_output"],
                agent=agents[t["agent"]],
                guardrail=guardrail,
            )
        )
    proc = Process.sequential if spec.get("process", "sequential") == "sequential" else Process.hierarchical
    return Crew(agents=list(agents.values()), tasks=tasks, process=proc, verbose=False)


# ---------------------------------------------------------------------------
# 3) Event listener — maps every crewai event to a normalized "forge event".
#    In prod, emit() HTTP-POSTs to /api/internal/events. Here it prints a
#    live timeline and records the stream.
# ---------------------------------------------------------------------------
STREAM: list[dict[str, Any]] = []


def emit(kind: str, **fields: Any) -> None:
    evt = {"ts": dt.datetime.now().strftime("%H:%M:%S.%f")[:-3], "kind": kind, **fields}
    STREAM.append(evt)
    extra = " ".join(f"{k}={v}" for k, v in fields.items() if v)
    print(f"  [{evt['ts']}] {kind:<26} {extra}")


class ForgeEventListener(BaseEventListener):
    def setup_listeners(self, bus):
        @bus.on(CrewKickoffStartedEvent)
        def _(src, e):  # noqa: ANN001
            emit("crew.kickoff.started", crew=getattr(e, "crew_name", None))

        @bus.on(AgentExecutionStartedEvent)
        def _(src, e):
            emit("agent.execution.started", agent=getattr(getattr(e, "agent", None), "role", None))

        @bus.on(LLMCallStartedEvent)
        def _(src, e):
            emit("llm.call.started")

        @bus.on(AgentExecutionCompletedEvent)
        def _(src, e):
            emit("agent.execution.completed", agent=getattr(getattr(e, "agent", None), "role", None))

        @bus.on(TaskStartedEvent)
        def _(src, e):
            emit("task.started")

        @bus.on(TaskCompletedEvent)
        def _(src, e):
            emit("task.completed")

        @bus.on(CrewKickoffCompletedEvent)
        def _(src, e):
            emit("crew.kickoff.completed")


# ---------------------------------------------------------------------------
# 4) HITL gate — a task guardrail the worker fully owns. crewai calls it with
#    the task output BEFORE passing it downstream; we inspect it, "ask the human"
#    (here: canned approval; in prod: long-poll the control plane), and return
#    (approved, value). Returning (False, feedback) would trigger a revision loop.
#    Version-robust: unaffected by crewai's native human_input internals.
# ---------------------------------------------------------------------------
HITL_PROMPTS: list[str] = []


def hitl_gate(output):
    text = getattr(output, "raw", str(output))
    HITL_PROMPTS.append(text)
    emit("hitl.gate.reached", chars=len(text))
    # <-- production: block here on a long-poll to /api/runs/{id}/input
    decision = "approve"
    emit("hitl.decision.received", decision=decision)
    return (True, output)


# ---------------------------------------------------------------------------
SPEC = {
    "process": "sequential",
    "agents": [
        {"id": "researcher", "role": "Researcher",
         "goal": "Find key facts about a topic",
         "backstory": "A meticulous analyst who gathers reliable information."},
        {"id": "writer", "role": "Writer",
         "goal": "Write a crisp summary from research",
         "backstory": "A concise writer who turns notes into clear prose."},
    ],
    "tasks": [
        {"agent": "researcher", "description": "Research the benefits of no-code agent tooling.",
         "expected_output": "3 bullet points.", "human_input": True},
        {"agent": "writer", "description": "Write a one-paragraph summary from the research.",
         "expected_output": "One paragraph."},
    ],
}


def main() -> None:
    print("=== Spike B: spec -> adapter -> crew -> live events + HITL ===\n")
    llm = FakeLLM()
    crew = build_crew(SPEC, llm, hitl_gate=hitl_gate)
    print(f"adapter built crew: {len(crew.agents)} agents, {len(crew.tasks)} tasks, "
          f"process={crew.process}\n")

    listener = ForgeEventListener()  # noqa: F841 (registers on construction)

    print("live event timeline:")
    result = crew.kickoff()

    print("\n--- RESULTS ---")
    print(f"events captured : {len(STREAM)}")
    kinds = {}
    for e in STREAM:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"event kinds     : {kinds}")
    print(f"HITL prompts intercepted: {len(HITL_PROMPTS)}")
    print(f"final output (truncated): {str(result)[:160]!r}")

    ok = (
        len(STREAM) > 0
        and "crew.kickoff.completed" in kinds
        and len(HITL_PROMPTS) >= 1
    )
    print(f"\nSPIKE B: {'PASS ✅' if ok else 'FAIL ❌'}")


if __name__ == "__main__":
    main()
