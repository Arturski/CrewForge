"""Spec <-> CrewAI translation layer: manifest (introspection) + adapter (build)."""
from .adapter import FakeLLM, build_crew
from .manifest import build_manifest

__all__ = ["build_manifest", "build_crew", "FakeLLM"]
