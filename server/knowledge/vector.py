"""Local embeddings (fastembed) + chunking + cosine search. No API key needed."""
from __future__ import annotations

import functools

import numpy as np

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


@functools.lru_cache(maxsize=2)
def _model(name: str):
    from fastembed import TextEmbedding
    return TextEmbedding(name)


def embed(texts: list[str], model: str = DEFAULT_MODEL) -> list[list[float]]:
    return [[float(x) for x in v] for v in _model(model).embed(list(texts))]


def chunk(text: str, words: int = 220, overlap: int = 30) -> list[str]:
    toks = text.split()
    if not toks:
        return []
    out, i = [], 0
    while i < len(toks):
        out.append(" ".join(toks[i:i + words]))
        i += words - overlap
    return out


def rank(query_vec: list[float], items: list[dict], k: int = 5) -> list[dict]:
    """items: [{..., 'emb': [...]}] -> top-k by cosine, with 'score' added."""
    if not items:
        return []
    q = np.array(query_vec, dtype=float)
    qn = q / (np.linalg.norm(q) or 1.0)
    mat = np.array([it["emb"] for it in items], dtype=float)
    norms = np.linalg.norm(mat, axis=1)
    norms[norms == 0] = 1.0
    scores = (mat @ qn) / norms
    order = np.argsort(-scores)[:k]
    return [{**items[i], "score": float(scores[i])} for i in order]
