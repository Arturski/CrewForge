"""Fetch a provider's *live* model list so the UI never shows stale presets.

Most providers expose an OpenAI-compatible GET /models; Anthropic and Gemini
have their own list endpoints. Returns bare model ids (the UI applies the
LiteLLM prefix). Best-effort; raises on transport/auth errors so the caller can
surface them.
"""
from __future__ import annotations

import httpx

_TIMEOUT = 15


def _openai_compatible(base: str, key: str | None, default_base: str) -> list[str]:
    base = (base or default_base).rstrip("/")
    url = base if base.endswith("/models") else base + "/models"
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    r = httpx.get(url, headers=headers, timeout=_TIMEOUT)
    r.raise_for_status()
    data = r.json().get("data", [])
    return sorted({m["id"] for m in data if m.get("id")})


def fetch_models(provider: str, base_url: str = "", key: str | None = None) -> list[str]:
    if provider == "openai":
        return _openai_compatible(base_url, key, "https://api.openai.com/v1")
    if provider == "groq":
        return _openai_compatible(base_url, key, "https://api.groq.com/openai/v1")
    if provider == "ollama":
        return _openai_compatible(base_url, key or "ollama", "http://localhost:11434/v1")
    if provider in ("minimax", "custom"):
        if not base_url:
            return []
        return _openai_compatible(base_url, key, base_url)
    if provider == "anthropic":
        r = httpx.get("https://api.anthropic.com/v1/models",
                      headers={"x-api-key": key or "", "anthropic-version": "2023-06-01"},
                      timeout=_TIMEOUT)
        r.raise_for_status()
        return sorted({m["id"] for m in r.json().get("data", []) if m.get("id")})
    if provider == "gemini":
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                      params={"key": key or ""}, timeout=_TIMEOUT)
        r.raise_for_status()
        out = []
        for m in r.json().get("models", []):
            mid = (m.get("name") or "").split("/")[-1]
            if mid and "generateContent" in (m.get("supportedGenerationMethods") or []):
                out.append(mid)
        return sorted(set(out))
    return []
