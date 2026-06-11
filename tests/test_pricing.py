"""Cost estimation from token usage — curated pricing, prefix matching."""
from server import pricing
from server.runner import _extract_usage


class _Ev:
    def __init__(self, usage):
        self.usage = usage


def test_rate_prefix_matching_and_prefix_stripping():
    assert pricing.rate_for("openai/gpt-4o-mini") == pricing.PRICES["gpt-4o-mini"]
    assert pricing.rate_for("hosted_vllm/MiniMax-M3") == pricing.PRICES["minimax-m3"]
    # dated suffixes resolve via longest prefix
    assert pricing.rate_for("anthropic/claude-sonnet-4-5-20250929") == pricing.PRICES["claude-sonnet-4"]
    assert pricing.rate_for("gpt-4o-mini-2024-07-18") == pricing.PRICES["gpt-4o-mini"]
    assert pricing.rate_for("some/unknown-model") is None
    assert pricing.rate_for(None) is None


def test_estimate_math_and_unknown():
    # gpt-4o-mini: $0.15/M in, $0.60/M out
    cost = pricing.estimate("gpt-4o-mini", 1_000_000, 1_000_000)
    assert round(cost, 2) == 0.75
    assert pricing.estimate("unknown", 100, 100) is None
    assert pricing.estimate("gpt-4o-mini", 0, 0) == 0.0


def test_extract_usage_shapes():
    assert _extract_usage(_Ev({"prompt_tokens": 10, "completion_tokens": 5})) == (10, 5, 15)
    assert _extract_usage(_Ev({"total_tokens": 42})) == (0, 0, 42)
    assert _extract_usage(_Ev(None)) == (0, 0, 0)
