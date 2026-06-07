"""Spike A — Compatibility engine proof.

Generic introspection of CrewAI's Pydantic models -> a UI-renderable capability
manifest. The whole compatibility strategy rests on this being *generic*: forms
are derived from the installed crewai's models, so a new field on Agent/Task/Crew
surfaces as a new control with ZERO UI/code changes.

This file is a throwaway spike. If it works, it gets promoted to
`server/compiler/manifest.py` in P0.

Run:  uv run python spikes/spike_a_manifest/introspect.py
"""
from __future__ import annotations

import enum
import json
import typing
from typing import Any, get_args, get_origin

import crewai
from pydantic import BaseModel
from pydantic_core import PydanticUndefined

# The structural primitives we expose. Everything else is derived generically.
TARGET_MODELS: dict[str, type[BaseModel]] = {
    "Agent": crewai.Agent,
    "Task": crewai.Task,
    "Crew": crewai.Crew,
}

# Long string fields render as multi-line. Heuristic only; never blocks a field.
TEXTAREA_HINTS = {"backstory", "goal", "description", "expected_output", "template"}


def _unwrap_optional(annotation: Any) -> tuple[Any, bool]:
    """Return (inner_type, is_optional) collapsing Optional[X] / X | None."""
    origin = get_origin(annotation)
    if origin is typing.Union or origin is getattr(__import__("types"), "UnionType", None):
        args = [a for a in get_args(annotation) if a is not type(None)]
        is_optional = len(args) != len(get_args(annotation))
        if len(args) == 1:
            return args[0], is_optional
        return typing.Union[tuple(args)], is_optional  # type: ignore[valid-type]
    return annotation, False


def _control_for(annotation: Any, field_name: str) -> dict[str, Any]:
    """Map a Python/Pydantic annotation -> a UI control descriptor.

    The 'json' control is the universal escape hatch: any type we don't model
    cleanly is still reachable as raw JSON, so NO crewai feature is ever
    un-configurable, even before a nice control exists.
    """
    annotation, _ = _unwrap_optional(annotation)
    origin = get_origin(annotation)

    # Literal[...] -> select with fixed options
    if origin is typing.Literal:
        return {"control": "select", "options": [repr(a) for a in get_args(annotation)]}

    # Enum -> select
    if isinstance(annotation, type) and issubclass(annotation, enum.Enum):
        return {"control": "select", "options": [e.value for e in annotation]}

    # bool -> toggle
    if annotation is bool:
        return {"control": "toggle"}

    # numbers
    if annotation in (int, float):
        return {"control": "number", "numeric": annotation.__name__}

    # str -> text or textarea
    if annotation is str:
        is_long = any(h in field_name for h in TEXTAREA_HINTS)
        return {"control": "textarea" if is_long else "text"}

    # list / set -> multi-entry; record item type if discoverable
    if origin in (list, set, tuple):
        args = get_args(annotation)
        item = _control_for(args[0], field_name) if args else {"control": "text"}
        return {"control": "list", "item": item}

    # dict -> key/value editor
    if origin is dict:
        return {"control": "keyvalue"}

    # nested Pydantic model -> nested form (recurse one level for shape preview)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return {"control": "nested", "model": annotation.__name__}

    # Anything else (callables, BaseTool, LLM unions, Any...) -> raw JSON escape hatch
    return {"control": "json", "note": f"raw ({_type_name(annotation)})"}


def _type_name(annotation: Any) -> str:
    return getattr(annotation, "__name__", str(annotation))


def _default_of(field) -> Any:
    if field.default is not PydanticUndefined:
        d = field.default
        return d if _json_safe(d) else _type_name(type(d))
    if field.default_factory is not None:  # type: ignore[attr-defined]
        try:
            d = field.default_factory()  # type: ignore[misc]
            return d if _json_safe(d) else _type_name(type(d))
        except Exception:
            return None
    return None


def _json_safe(v: Any) -> bool:
    try:
        json.dumps(v)
        return True
    except Exception:
        return False


def introspect_model(model: type[BaseModel]) -> list[dict[str, Any]]:
    fields = []
    for name, field in model.model_fields.items():
        annotation, optional = _unwrap_optional(field.annotation)
        fields.append(
            {
                "name": name,
                "type": _type_name(annotation),
                "required": field.is_required(),
                "optional": optional,
                "default": _default_of(field),
                "description": (field.description or "").strip()[:140] or None,
                "ui": _control_for(field.annotation, name),
            }
        )
    return fields


def build_manifest() -> dict[str, Any]:
    return {
        "crewai_version": crewai.__version__,
        "generated_by": "spike_a/introspect.py",
        "models": {name: introspect_model(m) for name, m in TARGET_MODELS.items()},
    }


# ---- Proof harness ----------------------------------------------------------

def _demo_future_field_appears() -> None:
    """Simulate a future crewai release adding a field, with ZERO code changes
    to the introspector, and show the new control appears automatically."""

    class FutureAgentLike(BaseModel):
        role: str
        # <-- pretend crewai 2.x adds these
        confidence_threshold: float = 0.8
        guardrail_policy: typing.Literal["strict", "lenient"] = "strict"
        new_secret_flag: bool = False

    fields = introspect_model(FutureAgentLike)
    print("\n=== PROOF: a 'future' model's new fields map to controls automatically ===")
    for f in fields:
        print(f"  {f['name']:<22} type={f['type']:<10} -> {f['ui']}")


def main() -> None:
    manifest = build_manifest()
    print(f"crewai {manifest['crewai_version']} — introspected models: {list(manifest['models'])}")
    counts = {k: len(v) for k, v in manifest["models"].items()}
    print(f"configurable fields discovered: {counts}  (total {sum(counts.values())})")

    # Spot-check: show how 6 representative Agent fields render
    print("\n=== Sample: Agent fields -> UI controls ===")
    by_name = {f["name"]: f for f in manifest["models"]["Agent"]}
    for key in ["role", "backstory", "verbose", "max_iter", "reasoning", "tools", "llm"]:
        if key in by_name:
            f = by_name[key]
            req = "required" if f["required"] else "optional"
            print(f"  {key:<14} ({req:<8}) {f['type']:<14} -> {f['ui']['control']}")

    _demo_future_field_appears()

    out = "spikes/spike_a_manifest/manifest.json"
    with open(out, "w") as fh:
        json.dump(manifest, fh, indent=2, default=str)
    print(f"\nfull manifest written -> {out}")


if __name__ == "__main__":
    main()
