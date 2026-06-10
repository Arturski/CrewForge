"""Knowledge base orchestration: CRUD + ingestion + search.

Phase 1: file + pasted text -> vector index (keyless local embeddings).
Phase 2: web page / docs-site crawl + GitHub repo ingestion, with live
progress on the source row (the UI polls while status == processing).
Phase 3: Kuzu graph — explicit "Build graph" extracts entities/relations with
the default LLM connection (incremental over ungraphed chunks; never runs
automatically, so ingesting never spends API tokens), then search turns hybrid.
"""
from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

from .. import store
from . import extract, graph, vector


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
    graph.delete(kb_id)


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
               filename: str | None = None, content: bytes | None = None,
               url: str | None = None, crawl: bool = False, max_pages: int = 30) -> dict[str, Any]:
    src = {"id": f"src-{uuid.uuid4().hex[:8]}", "kb_id": kb_id, "kind": kind,
           "ref": ref or url or filename or (text[:40] + "…" if text else "text"),
           "status": "processing", "chunks": 0, "error": None, "progress": None,
           "created": _now()}
    store.save_source(src)
    threading.Thread(target=_ingest,
                     args=(kb_id, src, text, filename, content, url, crawl, max_pages),
                     daemon=True).start()
    return src


def _collect_docs(src: dict[str, Any], text, filename, content, url, crawl, max_pages,
                  progress) -> list[tuple[str, str]]:
    """Resolve a source into [(doc_ref, text)] documents to index."""
    kind = src["kind"]
    if kind == "url":
        from . import web
        if crawl:
            progress("crawling…")
            return web.crawl(url, max_pages=max_pages,
                             on_progress=lambda done, total: progress(f"{done}/{total} pages"))
        title, page_text, _ = web.fetch_page(url)
        if title:
            src["ref"] = title[:80]
        return [(url, page_text)]
    if kind == "github":
        from . import github
        progress("downloading repo…")
        return github.fetch_repo(url, on_progress=lambda done, total: progress(f"{done}/{total} files"))
    return [(src["ref"], _extract(kind, text=text, filename=filename, content=content))]


def _ingest(kb_id: str, src: dict[str, Any], text, filename, content,
            url=None, crawl=False, max_pages=30) -> None:
    def progress(msg: str) -> None:
        src["progress"] = msg
        store.save_source(src)

    try:
        docs = _collect_docs(src, text, filename, content, url, crawl, max_pages, progress)
        docs = [(ref, t) for ref, t in docs if t]
        if not docs:
            raise ValueError("no text extracted")
        total_chunks = 0
        for d_i, (doc_ref, raw) in enumerate(docs):
            chunks = vector.chunk(raw)
            if not chunks:
                continue
            embs = vector.embed(chunks)
            rows = [(f"{src['id']}-{d_i}-{i}", ch, emb, {"source": doc_ref})
                    for i, (ch, emb) in enumerate(zip(chunks, embs))]
            store.add_chunks(kb_id, src["id"], rows)
            total_chunks += len(chunks)
            if len(docs) > 1:
                progress(f"indexed {d_i + 1}/{len(docs)} docs")
        if not total_chunks:
            raise ValueError("no text extracted")
        src["status"] = "ready"
        src["chunks"] = total_chunks
        src["progress"] = None
    except Exception as e:  # noqa: BLE001
        src["status"] = "error"
        src["error"] = f"{type(e).__name__}: {e}"[:300]
        src["progress"] = None
    store.save_source(src)


# -- search ------------------------------------------------------------------
def search(kb_id: str, query: str, k: int = 5) -> list[dict[str, Any]]:
    items = store.get_chunks(kb_id)
    if not items:
        return []
    qv = vector.embed([query])[0]
    hits = vector.rank(qv, items, k=k)
    return [{"chunk_id": h["chunk_id"], "text": h["text"], "score": round(h["score"], 3),
             "source": h["meta"].get("source", "")}
            for h in hits]


def related_facts(kb_id: str, chunk_ids: list[str], limit: int = 12) -> list[dict[str, str]]:
    """Graph hop for hybrid retrieval: entity facts connected to these chunks."""
    return graph.related_facts(kb_id, chunk_ids, limit=limit)


# -- knowledge graph (Phase 3) -------------------------------------------------
def _set_graph_state(kb_id: str, state: dict[str, Any]) -> None:
    kb = store.get_kb(kb_id)
    if kb:
        kb["graph"] = state
        store.save_kb(kb)


def graph_overview(kb_id: str) -> dict[str, Any]:
    kb = store.get_kb(kb_id) or {}
    state = kb.get("graph") or {"status": "none"}
    return {"graph": state, **graph.overview(kb_id)}


def build_graph(kb_id: str) -> dict[str, Any]:
    """Start (or resume) entity/relation extraction over ungraphed chunks."""
    from .. import llms
    kb = store.get_kb(kb_id)
    if not kb:
        raise KeyError(kb_id)
    if (kb.get("graph") or {}).get("status") == "building":
        return kb["graph"]
    llm = llms.build()
    if llm is None:
        raise ValueError("No model configured — add an LLM connection in Settings → Models first.")
    state = {"status": "building", "progress": "starting…"}
    _set_graph_state(kb_id, state)
    threading.Thread(target=_build_graph, args=(kb_id, llm), daemon=True).start()
    return state


def _build_graph(kb_id: str, llm: Any) -> None:
    try:
        chunks = store.get_chunks(kb_id)
        done = graph.graphed_chunks(kb_id)
        todo = [c for c in chunks if c["chunk_id"] not in done]
        skipped = 0
        for i, ch in enumerate(todo):
            res = extract.extract(llm, ch["text"])
            if not res["entities"]:
                skipped += 1
            graph.add_chunk(kb_id, ch["chunk_id"], ch["meta"].get("source", ""),
                            res["entities"], res["relations"])
            _set_graph_state(kb_id, {"status": "building",
                                     "progress": f"{i + 1}/{len(todo)} chunks"})
        stats = graph.stats(kb_id)
        _set_graph_state(kb_id, {"status": "ready", **stats,
                                 **({"skipped": skipped} if skipped else {})})
    except Exception as e:  # noqa: BLE001 — surface any provider/parse failure on the KB
        _set_graph_state(kb_id, {"status": "error", "error": f"{type(e).__name__}: {e}"[:300],
                                 **graph.stats(kb_id)})
