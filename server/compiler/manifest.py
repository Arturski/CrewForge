"""Capability manifest — generic introspection of the installed crewai's Pydantic
models into a UI-renderable schema.

This is CrewForge's compatibility centerpiece (promoted from spike A): the UI
renders all config forms from this manifest, so new crewai fields surface as new
controls with zero UI/code changes. The ``json`` control is the universal escape
hatch so no field is ever un-configurable.
"""
from __future__ import annotations

import enum
import functools
import json
import types
import typing
from typing import Any, get_args, get_origin

import crewai
from pydantic import BaseModel
from pydantic_core import PydanticUndefined

TARGET_MODELS: dict[str, type[BaseModel]] = {
    "Agent": crewai.Agent,
    "Task": crewai.Task,
    "Crew": crewai.Crew,
}

TEXTAREA_HINTS = {"backstory", "goal", "description", "expected_output", "template"}


def _unwrap_optional(annotation: Any) -> tuple[Any, bool]:
    origin = get_origin(annotation)
    if origin is typing.Union or origin is getattr(types, "UnionType", None):
        args = [a for a in get_args(annotation) if a is not type(None)]
        optional = len(args) != len(get_args(annotation))
        if len(args) == 1:
            return args[0], optional
        return typing.Union[tuple(args)], optional  # type: ignore[valid-type]
    return annotation, False


def _type_name(annotation: Any) -> str:
    return getattr(annotation, "__name__", str(annotation))


def _control_for(annotation: Any, field_name: str) -> dict[str, Any]:
    annotation, _ = _unwrap_optional(annotation)
    origin = get_origin(annotation)

    if origin is typing.Literal:
        return {"control": "select", "options": [str(a) for a in get_args(annotation)]}
    if isinstance(annotation, type) and issubclass(annotation, enum.Enum):
        return {"control": "select", "options": [e.value for e in annotation]}
    if annotation is bool:
        return {"control": "toggle"}
    if annotation in (int, float):
        return {"control": "number", "numeric": annotation.__name__}
    if annotation is str:
        is_long = any(h in field_name for h in TEXTAREA_HINTS)
        return {"control": "textarea" if is_long else "text"}
    if origin in (list, set, tuple):
        args = get_args(annotation)
        item = _control_for(args[0], field_name) if args else {"control": "text"}
        return {"control": "list", "item": item}
    if origin is dict:
        return {"control": "keyvalue"}
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return {"control": "nested", "model": annotation.__name__}
    return {"control": "json", "note": f"raw ({_type_name(annotation)})"}


def _json_safe(v: Any) -> bool:
    try:
        json.dumps(v)
        return True
    except Exception:
        return False


def _default_of(field) -> Any:  # noqa: ANN001
    if field.default is not PydanticUndefined:
        return field.default if _json_safe(field.default) else _type_name(type(field.default))
    if field.default_factory is not None:
        try:
            d = field.default_factory()
            return d if _json_safe(d) else _type_name(type(d))
        except Exception:
            return None
    return None


def introspect_model(model: type[BaseModel]) -> list[dict[str, Any]]:
    out = []
    for name, field in model.model_fields.items():
        annotation, optional = _unwrap_optional(field.annotation)
        out.append(
            {
                "name": name,
                "type": _type_name(annotation),
                "required": field.is_required(),
                "optional": optional,
                "default": _default_of(field),
                "description": (field.description or "").strip()[:160] or None,
                "ui": _control_for(field.annotation, name),
            }
        )
    return out


@functools.lru_cache(maxsize=1)
def build_manifest() -> dict[str, Any]:
    """Cached capability manifest for the installed crewai version."""
    return {
        "crewai_version": crewai.__version__,
        "models": {name: introspect_model(m) for name, m in TARGET_MODELS.items()},
        "counts": {name: len(m.model_fields) for name, m in TARGET_MODELS.items()},
    }
