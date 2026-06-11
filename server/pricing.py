"""Cost estimates from token usage.

Curated per-1M-token prices (USD input, output) for common models — crewai no
longer ships litellm's pricing table, and a small static table beats a network
fetch for a self-hosted tool. Prices drift: treat every figure as an ESTIMATE
(the UI labels it "est."). Unknown models yield None (no cost shown) rather
than a wrong number.
"""
from __future__ import annotations

# Longest-prefix matched against the normalized model name (lowercase, provider
# prefix stripped). Keep keys lowercase.
PRICES: dict[str, tuple[float, float]] = {
    # OpenAI
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1": (2.00, 8.00),
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-5": (1.25, 10.00),
    "o3-mini": (1.10, 4.40),
    "o3": (2.00, 8.00),
    "o4-mini": (1.10, 4.40),
    # Anthropic
    "claude-opus-4": (15.00, 75.00),
    "claude-sonnet-4": (3.00, 15.00),
    "claude-haiku-4": (1.00, 5.00),
    "claude-3-7-sonnet": (3.00, 15.00),
    "claude-3-5-haiku": (0.80, 4.00),
    # Google
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.0-flash": (0.10, 0.40),
    # DeepSeek
    "deepseek-chat": (0.27, 1.10),
    "deepseek-reasoner": (0.55, 2.19),
    # Mistral
    "mistral-large": (2.00, 6.00),
    "mistral-medium": (0.40, 2.00),
    "mistral-small": (0.10, 0.30),
    # Meta (typical hosted rates)
    "llama-3.3-70b": (0.59, 0.79),
    "llama-3.1-8b": (0.05, 0.08),
    # MiniMax
    "minimax-m2": (0.30, 1.20),
    "minimax-m3": (0.30, 1.20),
    "minimax-text-01": (0.20, 1.10),
    # xAI
    "grok-4": (3.00, 15.00),
    "grok-3-mini": (0.30, 0.50),
    "grok-3": (3.00, 15.00),
}


def _normalize(model: str) -> str:
    name = model.rsplit("/", 1)[-1].strip().lower()
    return name


def rate_for(model: str | None) -> tuple[float, float] | None:
    """(input $/1M, output $/1M) for a model wire name, or None if unknown."""
    if not model:
        return None
    name = _normalize(model)
    best = None
    for key, rate in PRICES.items():
        if name.startswith(key) and (best is None or len(key) > len(best[0])):
            best = (key, rate)
    return best[1] if best else None


def estimate(model: str | None, prompt_tokens: int, completion_tokens: int) -> float | None:
    """Estimated USD cost for one call; None when the model isn't priced."""
    rate = rate_for(model)
    if rate is None:
        return None
    return (prompt_tokens * rate[0] + completion_tokens * rate[1]) / 1_000_000
