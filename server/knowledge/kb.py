"""Knowledge base orchestration: CRUD + ingestion (text/file) + search.

Phase 1: file + pasted text -> vector index (keyless local embeddings).
Web/GitHub crawl + Kuzu graph extraction come in later phases.
"""
from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

from .. import store
from . import vector


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def create_kb(name: str, description: str = "", embedder: str = "local") -> dict[str, Any]:
    kb = {
        "id": f"kb-{uuid.uuid4().hex[:8]}",
        "name": name or "Knowledge base",
        "description": description,
        "embedder": embedder,
        "created": _now(),
        "stats": {"sources": 0, "chunks": 0},
    }
    return store.save_kb(kb)


def list_kbs() -> list[dict[str, Any]]:
    return store.list_kbs()


def get_kb(kb_id: str) -> dict[str, Any] | None:
    kb = store.get_kb(kb_id)
    if kb:
        kb["sources"] = store.list_sources(kb_id)
        kb["stats"] = {"sources": len(kb["sources"]), "chunks": store.count_chunks(kb_id)}
    return kb


def delete_kb(kb_id: str) -> None:
    store.delete_kb(kb_id)


# -- ingestion ---------------------------------------------------------------
def _extract(kind: str, *, text: str | None, filename: str | None, content: bytes | None) -> str:
    if kind == "text":
        return text or ""
    if kind == "file":
        name = (filename or "").lower()
        if name.endswith(".pdf"):
            import fitz  # pymupdf
            doc = fitz.open(stream=content, filetype="pdf")
            return "\n".join(page.get_text() for page in doc)
        if name.endswith(".docx"):
            import io

            import docx
            return "\n".join(p.text for p in docx.Document(io.BytesIO(content or b"")).paragraphs)
        return (content or b"").decode("utf-8", errors="ignore")
    return ""


def add_source(kb_id: str, kind: str, *, ref: str = "", text: str | None = None,
               filename: str | None = None, content: bytes | None = None) -> dict[str, Any]:
    src = {"id": f"src-{uuid.uuid4().hex[:8]}", "kb_id": kb_id, "kind": kind,
           "ref": ref or filename or (text[:40] + "…" if text else "text"),
           "status": "processing", "chunks": 0, "error": None, "created": _now()}
    store.save_source(src)
    threading.Thread(target=_ingest, args=(kb_id, src, text, filename, content),
                     daemon=True).start()
    return src


def _ingest(kb_id: str, src: dict[str, Any], text, filename, content) -> None:
    try:
        raw = _extract(src["kind"], text=text, filename=filename, content=content)
        chunks = vector.chunk(raw)
        if not chunks:
            raise ValueError("no text extracted")
        embs = vector.embed(chunks)
        rows = [(f"{src['id']}-{i}", ch, emb, {"source": src["ref"]})
                for i, (ch, emb) in enumerate(zip(chunks, embs))]
        store.add_chunks(kb_id, src["id"], rows)
        src["status"] = "ready"
        src["chunks"] = len(chunks)
    except Exception as e:  # noqa: BLE001
        src["status"] = "error"
        src["error"] = f"{type(e).__name__}: {e}"[:300]
    store.save_source(src)


# -- search ------------------------------------------------------------------
def search(kb_id: str, query: str, k: int = 5) -> list[dict[str, Any]]:
    items = store.get_chunks(kb_id)
    if not items:
        return []
    qv = vector.embed([query])[0]
    hits = vector.rank(qv, items, k=k)
    return [{"text": h["text"], "score": round(h["score"], 3), "source": h["meta"].get("source", "")}
            for h in hits]
